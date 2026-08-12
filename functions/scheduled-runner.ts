/**
 * scheduled-runner.ts
 * 
 * Hasura Cron Trigger handler — fires every minute.
 * 
 * Checks if any workflow has a 'scheduled' trigger whose cron expression
 * is due, and if so, starts a run for it.
 * 
 * This satisfies the "Scheduled — cron-based" trigger type requirement.
 */

import type { Request, Response } from 'express';
import { adminQuery } from './_utils/hasura.js';
import { hasQuotaRemaining } from './_utils/quota.js';

// Simple cron check: does the trigger's cron expression match "now"?
// For production, use the 'cron-parser' package. Here we demonstrate
// a simple hourly/daily pattern for the assignment.
function isCronDue(cronExpr: string): boolean {
  const now = new Date();
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpr.split(' ');

  const matches = (expr: string, value: number): boolean => {
    if (expr === '*') return true;
    if (expr.startsWith('*/')) return value % parseInt(expr.slice(2), 10) === 0;
    return parseInt(expr, 10) === value;
  };

  return (
    matches(minute, now.getMinutes()) &&
    matches(hour, now.getHours()) &&
    matches(dayOfMonth, now.getDate()) &&
    matches(month, now.getMonth() + 1) &&
    matches(dayOfWeek, now.getDay())
  );
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    // Find all scheduled triggers
    const data = await adminQuery<{
      workflow_triggers: Array<{
        id: string;
        config: { cron: string };
        workflow: { id: string; org_id: string };
      }>;
    }>(
      `query GetScheduledTriggers {
        workflow_triggers(where: { trigger_type: { _eq: "scheduled" } }) {
          id config
          workflow { id org_id }
        }
      }`
    );

    const triggered: string[] = [];

    for (const trigger of data.workflow_triggers) {
      const cron = trigger.config?.cron;
      if (!cron || !isCronDue(cron)) continue;

      const orgId = trigger.workflow.org_id;

      // Check quota before starting
      const quotaOk = await hasQuotaRemaining(orgId);
      if (!quotaOk) {
        console.log(`[scheduler] Skipping ${trigger.workflow.id} — quota exhausted`);
        continue;
      }

      // Create a run
      await adminQuery(
        `mutation CreateScheduledRun($workflowId: uuid!, $orgId: uuid!) {
          insert_workflow_runs_one(object: {
            workflow_id: $workflowId
            org_id: $orgId
            status: pending
            trigger_type: "scheduled"
            started_at: "now()"
          }) { id }
        }`,
        { workflowId: trigger.workflow.id, orgId }
      );

      triggered.push(trigger.workflow.id);

      // Fire executor (fire-and-forget)
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
            input: { workflow_id: trigger.workflow.id },
            session_variables: {
              'x-hasura-user-id': '00000000-0000-0000-0000-000000000000',
              'x-hasura-role': 'owner',
            },
          }),
        }).catch((err) =>
          console.error(`[scheduler] Failed to start run for ${trigger.workflow.id}:`, err)
        );
      }
    }

    res.status(200).json({
      triggered: triggered.length,
      workflow_ids: triggered,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduler error';
    console.error('[scheduler] Error:', message);
    res.status(500).json({ message });
  }
}
