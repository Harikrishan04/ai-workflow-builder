/**
 * notify-handler.ts
 * 
 * Hasura Event Trigger handler.
 * Fires whenever a step_run of type 'notify' is marked 'completed'.
 * 
 * The Event Trigger is configured in Hasura to watch:
 *   table: step_runs
 *   event: UPDATE
 *   condition: NEW.status = 'completed'
 * 
 * WHY AN EVENT TRIGGER (not inline in the executor):
 *   Event Triggers are fire-and-forget and retried by Hasura automatically
 *   if the notification fails. This decouples the notification from the
 *   workflow execution — a Slack API outage won't fail the run.
 */

import type { Request, Response } from 'express';
import { adminQuery } from './_utils/hasura';

interface EventTriggerPayload {
  event: {
    op: string;
    data: {
      old: Record<string, unknown> | null;
      new: Record<string, unknown>;
    };
  };
  table: { schema: string; name: string };
  trigger: { name: string };
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as EventTriggerPayload;
    const newRow = body.event.data.new;

    const stepRunId = newRow['id'] as string;
    const runId = newRow['run_id'] as string;
    const stepId = newRow['step_id'] as string;

    // Only process notify steps
    const stepData = await adminQuery<{
      workflow_steps_by_pk: { step_type: string; config: Record<string, unknown> };
    }>(
      `query GetStep($id: uuid!) {
        workflow_steps_by_pk(id: $id) { step_type config }
      }`,
      { id: stepId }
    );

    const step = stepData.workflow_steps_by_pk;
    if (!step || step.step_type !== 'notify') {
      res.status(200).json({ ignored: true });
      return;
    }

    const config = step.config;
    const channel = (config['channel'] as string) || 'slack';
    const message = (config['message'] as string) ||
      `Workflow step completed. Run ID: ${runId}`;

    // Send to Slack
    if (channel === 'slack') {
      const slackWebhook = process.env.SLACK_WEBHOOK_URL;
      if (slackWebhook) {
        await fetch(slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });
      } else {
        console.log('[notify] Slack not configured. Message:', message);
      }
    }

    // Email could be added here via nhost auth email or SendGrid

    console.log(`[notify] Sent ${channel} notification for step_run ${stepRunId}`);
    res.status(200).json({ sent: true, channel });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notify handler error';
    console.error('[notify] Error:', message);
    // Return 200 to prevent Hasura from retrying on a bad config
    res.status(200).json({ error: message });
  }
}
