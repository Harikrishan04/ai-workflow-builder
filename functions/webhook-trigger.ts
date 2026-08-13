/**
 * webhook-trigger.ts
 * 
 * Public inbound webhook endpoint. External systems call this URL to start
 * a workflow run without a browser session.
 * 
 * WHY A SEPARATE HANDLER:
 *   Unlike triggerWorkflowRun (which uses the caller's JWT), this endpoint
 *   is public — there's no user logged in. Instead, each workflow's webhook
 *   trigger config contains a secret api_key. We validate that key here
 *   before starting the run.
 * 
 * This demonstrates the "webhook" trigger type from the assignment.
 */

import type { Request, Response } from 'express';
import { adminQuery } from './_utils/hasura';
import { hasQuotaRemaining } from './_utils/quota';

interface WebhookTriggerConfig {
  api_key: string;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    const input = (req.body as Record<string, unknown>)['input'] as {
      workflow_id: string;
      payload?: unknown;
      api_key: string;
    };

    const { workflow_id: workflowId, payload, api_key: providedKey } = input;

    if (!workflowId || !providedKey) {
      res.status(400).json({ message: 'workflow_id and api_key are required' });
      return;
    }

    // 1. Load the workflow and its webhook trigger config
    const data = await adminQuery<{
      workflow_triggers: Array<{
        id: string;
        config: WebhookTriggerConfig;
        workflow: { id: string; org_id: string };
      }>;
    }>(
      `query GetWebhookTrigger($workflowId: uuid!) {
        workflow_triggers(where: {
          workflow_id: { _eq: $workflowId }
          trigger_type: { _eq: "webhook" }
        }) {
          id config
          workflow { id org_id }
        }
      }`,
      { workflowId }
    );

    const trigger = data.workflow_triggers[0];

    if (!trigger) {
      // Return generic error to avoid confirming workflow existence to unauthorized callers
      res.status(404).json({ message: 'Not found' });
      return;
    }

    // 2. Validate the API key — this is the auth for webhook callers
    if (trigger.config.api_key !== providedKey) {
      res.status(403).json({ message: 'Invalid API key' });
      return;
    }

    const orgId = trigger.workflow.org_id;

    // 3. Check quota
    const quotaOk = await hasQuotaRemaining(orgId);
    if (!quotaOk) {
      res.status(429).json({ message: 'Organization quota exhausted' });
      return;
    }

    // 4. Create the workflow run
    const runData = await adminQuery<{
      insert_workflow_runs_one: { id: string };
    }>(
      `mutation CreateWebhookRun($workflowId: uuid!, $orgId: uuid!, $payload: jsonb) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflowId
          org_id: $orgId
          status: pending
          trigger_type: "webhook"
          started_at: "now()"
        }) { id }
      }`,
      { workflowId, orgId, payload: payload ?? {} }
    );

    const runId = runData.insert_workflow_runs_one.id;

    // 5. Fire-and-forget: call the main executor
    //    We don't await this so the webhook returns immediately.
    const functionsUrl = process.env.NHOST_FUNCTIONS_URL;
    if (functionsUrl) {
      fetch(`${functionsUrl}/trigger-workflow-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET || '',
        },
        body: JSON.stringify({
          action: { name: 'triggerWorkflowRun' },
          input: { workflow_id: workflowId },
          session_variables: {
            'x-hasura-user-id': '00000000-0000-0000-0000-000000000000', // system user
            'x-hasura-role': 'owner',
          },
          _internal_resume_run_id: runId,
        }),
      }).catch((err) => console.error('Webhook executor call failed:', err));
    }

    res.status(200).json({ run_id: runId, status: 'started' });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ message });
  }
}
