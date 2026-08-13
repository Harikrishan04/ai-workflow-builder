/**
 * trigger-workflow-run.ts
 * 
 * Hasura Action handler: triggerWorkflowRun(workflow_id: uuid!)
 * 
 * This is the core of the assignment. It:
 *  1. Verifies the caller is owner/editor in the workflow's org (LAYER 2)
 *  2. Checks the org's quota
 *  3. Creates a workflow_run record
 *  4. Executes each step in order, starting from resume_index
 *  5. On approval_gate: pauses and returns
 *  6. Updates step_runs throughout (drives the live subscription)
 *  7. Increments quota per external call
 * 
 * The subscription on step_runs is what makes the UI feel "live" —
 * every time we update a step_run's status, the frontend instantly
 * reflects it without any refresh.
 */

import type { Request, Response } from 'express';
import Groq from 'groq-sdk';
import { adminQuery } from './_utils/hasura.js';
import { parseSessionVars, requireRole } from './_utils/auth.js';
import { hasQuotaRemaining, incrementQuota } from './_utils/quota.js';
import { withRetry } from './_utils/retry.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  step_order: number;
  step_type:
    | 'llm_call'
    | 'http_request'
    | 'db_write'
    | 'notify'
    | 'conditional_branch'
    | 'approval_gate';
  config: Record<string, unknown>;
}

interface WorkflowRun {
  id: string;
  org_id: string;
  resume_index: number;
}

interface StepRun {
  id: string;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function getWorkflow(workflowId: string) {
  const data = await adminQuery<{
    workflows_by_pk: {
      id: string;
      org_id: string;
      workflow_steps: WorkflowStep[];
    } | null;
  }>(
    `query GetWorkflow($id: uuid!) {
      workflows_by_pk(id: $id) {
        id org_id
        workflow_steps(order_by: { step_order: asc }) {
          id step_order step_type config
        }
      }
    }`,
    { id: workflowId }
  );
  return data.workflows_by_pk;
}

async function createWorkflowRun(
  workflowId: string,
  orgId: string,
  triggerType: string
): Promise<WorkflowRun> {
  const data = await adminQuery<{
    insert_workflow_runs_one: WorkflowRun;
  }>(
    `mutation CreateRun($workflowId: uuid!, $orgId: uuid!, $triggerType: String!) {
      insert_workflow_runs_one(object: {
        workflow_id: $workflowId
        org_id: $orgId
        status: running
        trigger_type: $triggerType
        started_at: "now()"
      }) { id org_id resume_index }
    }`,
    { workflowId, orgId, triggerType }
  );
  return data.insert_workflow_runs_one;
}

async function getWorkflowRun(runId: string): Promise<WorkflowRun | null> {
  const data = await adminQuery<{
    workflow_runs_by_pk: WorkflowRun | null;
  }>(
    `query GetRun($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id org_id resume_index
      }
    }`,
    { id: runId }
  );
  return data.workflow_runs_by_pk;
}

async function getLastCompletedStepOutput(runId: string): Promise<unknown> {
  const data = await adminQuery<{
    step_runs: Array<{ output: unknown }>;
  }>(
    `query GetLastCompletedStep($runId: uuid!) {
      step_runs(
        where: {
          run_id: { _eq: $runId }
          status: { _eq: completed }
          output: { _is_null: false }
        }
        order_by: { step_order: desc }
        limit: 1
      ) {
        output
      }
    }`,
    { runId }
  );
  return data.step_runs[0]?.output ?? null;
}

async function createStepRun(
  runId: string,
  step: WorkflowStep,
  input: unknown
): Promise<StepRun> {
  const data = await adminQuery<{
    insert_step_runs_one: StepRun;
  }>(
    `mutation CreateStepRun($runId: uuid!, $stepId: uuid!, $stepOrder: Int!, $input: jsonb) {
      insert_step_runs_one(object: {
        run_id: $runId
        step_id: $stepId
        step_order: $stepOrder
        status: running
        input: $input
        attempt_count: 1
        started_at: "now()"
      }) { id }
    }`,
    { runId, stepId: step.id, stepOrder: step.step_order, input }
  );
  return data.insert_step_runs_one;
}

async function updateStepRun(
  stepRunId: string,
  update: {
    status: string;
    output?: unknown;
    error?: string;
    attempt_count?: number;
  }
) {
  const setPayload: Record<string, unknown> = {
    status: update.status,
    output: update.output ?? null,
    error: update.error ?? null,
    finished_at: ['completed', 'failed', 'skipped'].includes(update.status) ? 'now()' : null,
  };
  if (update.attempt_count !== undefined) {
    setPayload.attempt_count = update.attempt_count;
  }

  await adminQuery(
    `mutation UpdateStepRun($id: uuid!, $set: step_runs_set_input!) {
      update_step_runs_by_pk(
        pk_columns: { id: $id }
        _set: $set
      ) { id }
    }`,
    { id: stepRunId, set: setPayload }
  );
}

async function updateRunStatus(runId: string, status: string, resumeIndex?: number) {
  const setPayload: Record<string, unknown> = {
    status,
    finished_at: ['completed', 'failed'].includes(status) ? 'now()' : null,
  };
  if (resumeIndex !== undefined) {
    setPayload.resume_index = resumeIndex;
  }

  await adminQuery(
    `mutation UpdateRunStatus($id: uuid!, $set: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(
        pk_columns: { id: $id }
        _set: $set
      ) { id }
    }`,
    { id: runId, set: setPayload }
  );
}

// ─── Step Executors ───────────────────────────────────────────────────────────

/**
 * llm_call: Calls Groq API with the configured prompt.
 * The previous step's output is injected as context.
 */
async function executeLlmCall(
  config: Record<string, unknown>,
  previousOutput: unknown
): Promise<unknown> {
  let model = (config['model'] as string) || 'llama-3.1-8b-instant';
  if (model === 'llama3-8b-8192' || model === 'llama3-70b-8192') {
    model = 'llama-3.1-8b-instant';
  }
  const systemPrompt = (config['system_prompt'] as string) || 'You are a helpful assistant.';
  const userPrompt = (config['user_prompt'] as string) || '';

  const enrichedPrompt = previousOutput
    ? `${userPrompt}\n\nContext from previous step:\n${JSON.stringify(previousOutput, null, 2)}`
    : userPrompt;

  const completion = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: enrichedPrompt },
    ],
    max_tokens: (config['max_tokens'] as number) || 1024,
    temperature: (config['temperature'] as number) || 0.7,
  });

  return {
    text: completion.choices[0]?.message?.content ?? '',
    model: completion.model,
    usage: completion.usage,
  };
}

function injectPreviousOutput(template: unknown, previousOutput: unknown): unknown {
  if (typeof template === 'string') {
    if (template === '{{previousOutput}}') {
      return previousOutput;
    }
    return template.replace('{{previousOutput}}', typeof previousOutput === 'string' ? previousOutput : JSON.stringify(previousOutput));
  }
  if (Array.isArray(template)) {
    return template.map((item) => injectPreviousOutput(item, previousOutput));
  }
  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = injectPreviousOutput(value, previousOutput);
    }
    return result;
  }
  return template;
}

/**
 * http_request: Calls any external HTTP endpoint.
 * Supports GET/POST/PUT with configurable headers and body.
 */
async function executeHttpRequest(
  config: Record<string, unknown>,
  previousOutput: unknown
): Promise<unknown> {
  const url = config['url'] as string;
  const method = ((config['method'] as string) || 'GET').toUpperCase();
  const headers = (config['headers'] as Record<string, string>) || {};
  const bodyTemplate = config['body'];

  if (!url) throw new Error('http_request step requires a url in config');

  const injectedBody = bodyTemplate !== undefined ? injectPreviousOutput(bodyTemplate, previousOutput) : undefined;
  const bodyStr = injectedBody !== undefined ? (typeof injectedBody === 'string' ? injectedBody : JSON.stringify(injectedBody)) : undefined;

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: ['GET', 'HEAD'].includes(method) ? undefined : bodyStr,
  });

  const responseText = await response.text();
  let responseData: unknown;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  }

  return { status: response.status, data: responseData };
}

/**
 * db_write: Saves data into our own tables via admin mutation.
 * Config specifies which table and what data to insert.
 */
async function executeDbWrite(
  config: Record<string, unknown>,
  previousOutput: unknown,
  orgId: string
): Promise<unknown> {
  // Simple implementation: insert into a generic "workflow_outputs" concept
  // or update a designated field. Here we demonstrate saving to step context.
  const table = config['table'] as string;
  const fields = config['fields'] as Record<string, unknown>;

  if (!table || !fields) {
    throw new Error('db_write step requires table and fields in config');
  }

  // Inject org_id and previous output into fields for safety
  const enrichedFields = {
    ...fields,
    org_id: orgId,
    previous_output: previousOutput,
    created_at: 'now()',
  };

  // We use a raw insert — the actual table must exist in the schema
  await adminQuery(
    `mutation DbWrite($object: ${table}_insert_input!) {
      insert_${table}_one(object: $object) { id }
    }`,
    { object: enrichedFields }
  );

  return { written: true, table, fields: enrichedFields };
}

/**
 * conditional_branch: Evaluates the previous step's output and decides
 * which branch to take. Returns { branch: 'true' | 'false' }.
 * 
 * Config options:
 *   - condition: 'contains' | 'equals' | 'llm_classify'
 *   - value: string to check against
 *   - llm_prompt: (for llm_classify) ask LLM to return YES/NO
 */
async function executeConditionalBranch(
  config: Record<string, unknown>,
  previousOutput: unknown
): Promise<unknown> {
  const condition = config['condition'] as string;
  const value = config['value'] as string;
  const outputText = JSON.stringify(previousOutput).toLowerCase();

  let branch: 'true' | 'false';

  if (condition === 'contains') {
    branch = outputText.includes(value.toLowerCase()) ? 'true' : 'false';
  } else if (condition === 'equals') {
    branch = outputText === value.toLowerCase() ? 'true' : 'false';
  } else if (condition === 'llm_classify') {
    // Ask the LLM to classify the output — returns YES or NO
    const prompt = (config['llm_prompt'] as string) ||
      `Does the following text satisfy the condition? Answer only YES or NO.\nText: ${JSON.stringify(previousOutput)}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 5,
    });

    const answer = (completion.choices[0]?.message?.content ?? '').trim().toUpperCase();
    branch = answer.startsWith('YES') ? 'true' : 'false';
  } else {
    throw new Error(`Unknown condition type: ${condition}`);
  }

  return { branch, condition, value, evaluated_on: previousOutput };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    // 1. Parse session variables from the Hasura Action request
    const session = parseSessionVars(req.body as Record<string, unknown>);
    const input = (req.body as Record<string, unknown>)['input'] as {
      workflow_id: string;
      resume_from_run_id?: string;  // for internal resume calls from approveStep
    };

    const workflowId = input.workflow_id;

    // 2. Load the workflow and its steps
    const workflow = await getWorkflow(workflowId);
    if (!workflow) {
      res.status(404).json({ message: 'Workflow not found' });
      return;
    }

    // 3. LAYER 2: Re-query the DB to verify caller's role in this specific org
    //    We do NOT trust X-Hasura-Role from the session variables alone.
    await requireRole(session.userId, workflow.org_id, ['owner', 'editor'], session.role);

    // 4. Check quota BEFORE creating a run (fail fast)
    const quotaOk = await hasQuotaRemaining(workflow.org_id);
    if (!quotaOk) {
      res.status(429).json({ message: 'Organization quota exhausted for this period' });
      return;
    }

    const resumeRunId = input.resume_from_run_id || ((req.body as Record<string, unknown>)['_internal_resume_run_id'] as string | undefined);

    let run: WorkflowRun;
    let resumeIndex: number;
    let previousOutput: unknown = null;

    if (resumeRunId) {
      const existingRun = await getWorkflowRun(resumeRunId);
      if (!existingRun) {
        res.status(404).json({ message: 'Run to resume not found' });
        return;
      }
      run = existingRun;
      resumeIndex = existingRun.resume_index;
      previousOutput = await getLastCompletedStepOutput(run.id);
      await updateRunStatus(run.id, 'running', resumeIndex);
    } else {
      // 5. Create the workflow_run record. org_id is set HERE, server-side —
      //    never from client input. This prevents org hijacking.
      run = await createWorkflowRun(workflowId, workflow.org_id, 'manual');
      resumeIndex = 0;
    }

    const steps = workflow.workflow_steps;
    let runFailed = false;

    // 6. Execute each step in order, starting from resumeIndex
    for (let i = resumeIndex; i < steps.length; i++) {
      const step = steps[i];
      const stepRun = await createStepRun(run.id, step, previousOutput);

      try {
        let output: unknown;
        let attemptCount = 1;

        // ── Step type dispatch ──────────────────────────────────────────────

        if (step.step_type === 'llm_call') {
          // withRetry wraps the call — if Groq API fails, it retries up to 3x
          output = await withRetry(
            () => executeLlmCall(step.config, previousOutput),
            {
              maxAttempts: 3,
              onAttempt: (attempt, err) => {
                attemptCount = attempt;
                console.error(`llm_call attempt ${attempt} failed:`, err);
              },
            }
          );
          await incrementQuota(workflow.org_id);

        } else if (step.step_type === 'http_request') {
          output = await withRetry(
            () => executeHttpRequest(step.config, previousOutput),
            {
              maxAttempts: 3,
              onAttempt: (attempt, err) => {
                attemptCount = attempt;
                console.error(`http_request attempt ${attempt} failed:`, err);
              },
            }
          );
          await incrementQuota(workflow.org_id);

        } else if (step.step_type === 'db_write') {
          output = await executeDbWrite(step.config, previousOutput, workflow.org_id);

        } else if (step.step_type === 'notify') {
          // notify steps are handled by a Hasura Event Trigger that fires
          // when step_run status becomes 'completed' for notify type steps.
          // We just set the output here; the Event Trigger does the actual send.
          output = { queued: true, channel: step.config['channel'] || 'slack' };

        } else if (step.step_type === 'conditional_branch') {
          output = await executeConditionalBranch(step.config, previousOutput);

          // If branch is 'false', skip the next step
          const branchResult = output as { branch: 'true' | 'false' };
          if (branchResult.branch === 'false' && i + 1 < steps.length) {
            // Mark next step as skipped
            const nextStep = steps[i + 1];
            const skippedRun = await createStepRun(run.id, nextStep, null);
            await updateStepRun(skippedRun.id, { status: 'skipped' });
            i++; // skip the next iteration
          }

        } else if (step.step_type === 'approval_gate') {
          // ── PAUSE EXECUTION ─────────────────────────────────────────────
          // Set the step_run to paused. The subscription on the frontend
          // will immediately show the "Awaiting Approval" state.
          // Set resume_index so approveStep knows where to continue from.
          await updateStepRun(stepRun.id, { status: 'paused', output: previousOutput });
          await updateRunStatus(run.id, 'paused', i + 1); // Next step index to resume from

          res.status(200).json({
            run_id: run.id,
            status: 'paused',
          });
          return; // Stop execution here. approveStep will restart from resume_index.
        }

        // ── Mark step completed ─────────────────────────────────────────────
        await updateStepRun(stepRun.id, {
          status: 'completed',
          output,
          attempt_count: attemptCount,
        });

        // The output of this step becomes the input of the next step
        previousOutput = output;

      } catch (stepError) {
        const errorMessage =
          stepError instanceof Error ? stepError.message : String(stepError);

        await updateStepRun(stepRun.id, {
          status: 'failed',
          error: errorMessage,
        });

        await updateRunStatus(run.id, 'failed');
        runFailed = true;
        break;
      }
    }

    // 7. Mark the run as completed (or failed if something broke)
    if (!runFailed) {
      await updateRunStatus(run.id, 'completed');
    }

    res.status(200).json({
      run_id: run.id,
      status: runFailed ? 'failed' : 'completed',
    });

  } catch (error) {
    console.error('Trigger workflow run error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = (error as { status?: number }).status ?? 500;
    res.status(status).json({ message });
  }
}
