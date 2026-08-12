/**
 * approve-step.ts
 * 
 * Hasura Action handler: approveStep(step_run_id: uuid!)
 * 
 * This handler is the second half of the approval_gate mechanism.
 * 
 * FLOW:
 *   1. Load the paused step_run and its workflow_run
 *   2. LAYER 2: Re-query DB to confirm caller is owner/editor in the correct org
 *      (Cannot be just a DB permission — this is a mid-execution decision
 *       that requires knowing the specific org of this specific run)
 *   3. Mark the step_run as 'completed' with approver info
 *   4. Set workflow_run status back to 'running', resume_index = step_order + 1
 *   5. Re-invoke the executor to continue from the next step
 * 
 * WHY LAYER 2 MATTERS HERE:
 *   A Hasura row permission could prevent Org B from *reading* the step_run,
 *   but approving is a state mutation. We must verify the caller's role in
 *   the *run's org* server-side, not just check if they can see the row.
 */

import type { Request, Response } from 'express';
import { adminQuery } from './_utils/hasura.js';
import { parseSessionVars, requireRole } from './_utils/auth.js';

interface StepRunDetails {
  id: string;
  status: string;
  step_order: number;
  workflow_run: {
    id: string;
    workflow_id: string;
    org_id: string;
    status: string;
  };
}

async function getStepRun(stepRunId: string): Promise<StepRunDetails | null> {
  const data = await adminQuery<{ step_runs_by_pk: StepRunDetails | null }>(
    `query GetStepRun($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id status step_order
        workflow_run {
          id workflow_id org_id status
        }
      }
    }`,
    { id: stepRunId }
  );
  return data.step_runs_by_pk;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    // 1. Parse caller identity from Hasura session variables
    const session = parseSessionVars(req.body as Record<string, unknown>);
    const input = (req.body as Record<string, unknown>)['input'] as {
      step_run_id: string;
    };

    const stepRunId = input.step_run_id;

    // 2. Load the step_run (using admin, so no row permission filters apply yet)
    const stepRun = await getStepRun(stepRunId);

    if (!stepRun) {
      res.status(404).json({ message: 'Step run not found' });
      return;
    }

    // Validate current state — can only approve a paused step
    if (stepRun.status !== 'paused') {
      res.status(400).json({
        message: `Cannot approve step in status '${stepRun.status}'. Must be 'paused'.`,
      });
      return;
    }

    if (stepRun.workflow_run.status !== 'paused') {
      res.status(400).json({
        message: 'Workflow run is not paused',
      });
      return;
    }

    // 3. LAYER 2: Verify the caller is owner/editor in the org that OWNS this run.
    //    This is the critical check. An Org B editor cannot approve Org A's step,
    //    even if they somehow know the step_run_id (e.g., by guessing a UUID).
    await requireRole(session.userId, stepRun.workflow_run.org_id, ['owner', 'editor']);

    // 4. Mark the step_run as completed, recording who approved it and when
    await adminQuery(
      `mutation ApproveStepRun($id: uuid!, $approvedBy: uuid!) {
        update_step_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: completed
            approved_by: $approvedBy
            approved_at: "now()"
            finished_at: "now()"
          }
        ) { id }
      }`,
      { id: stepRunId, approvedBy: session.userId }
    );

    // 5. Advance the run: set resume_index to the step AFTER the approval gate
    const nextStepIndex = stepRun.step_order + 1;
    await adminQuery(
      `mutation ResumeRun($id: uuid!, $resumeIndex: Int!) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: running
            resume_index: $resumeIndex
          }
        ) { id }
      }`,
      { id: stepRun.workflow_run.id, resumeIndex: nextStepIndex }
    );

    // 6. Re-invoke the executor from the next step.
    //    We call the Hasura Action internally using the admin secret
    //    so it bypasses the JWT check (the JWT check already passed above).
    const functionsUrl = process.env.NHOST_FUNCTIONS_URL;
    if (functionsUrl) {
      // Fire and forget — the frontend subscription will show progress
      fetch(`${functionsUrl}/trigger-workflow-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass a synthetic session with admin-level trust
          'x-hasura-admin-secret': process.env.NHOST_ADMIN_SECRET || '',
        },
        body: JSON.stringify({
          // Reconstruct a minimal Action payload to re-enter the executor
          action: { name: 'triggerWorkflowRun' },
          input: { workflow_id: stepRun.workflow_run.workflow_id },
          session_variables: {
            'x-hasura-user-id': session.userId,
            'x-hasura-role': 'owner',
          },
          // Signal to the executor to start from resume_index
          _internal_resume_run_id: stepRun.workflow_run.id,
        }),
      }).catch((err) => console.error('Failed to resume workflow run:', err));
    }

    res.status(200).json({
      success: true,
      message: `Step approved. Workflow resuming from step ${nextStepIndex}.`,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = (error as { status?: number }).status ?? 500;
    res.status(status).json({ message });
  }
}
