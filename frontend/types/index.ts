/**
 * types/index.ts
 * Shared TypeScript interfaces for the entire frontend.
 * Eliminates the "any" types scattered through pages.
 */

export interface Organization {
  id: string;
  name: string;
  quota_used: number;
  quota_limit: number;
  quota_reset_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  organization: Organization;
}

export type StepType =
  | 'llm_call'
  | 'http_request'
  | 'db_write'
  | 'notify'
  | 'conditional_branch'
  | 'approval_gate';

export type TriggerType = 'manual' | 'webhook' | 'scheduled' | 'db_event';

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  step_order: number;
  step_type: StepType;
  config: Record<string, unknown>;
}

export interface WorkflowTrigger {
  id: string;
  workflow_id: string;
  trigger_type: TriggerType;
  config: Record<string, unknown>;
}

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  org_id: string;
  status: RunStatus;
  trigger_type: string | null;
  resume_index: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface StepRun {
  id: string;
  run_id: string;
  step_id: string;
  step_order: number;
  status: StepRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempt_count: number;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  workflow_step: WorkflowStep;
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  workflow_steps: WorkflowStep[];
  workflow_triggers: WorkflowTrigger[];
  workflow_runs: WorkflowRun[];
  organization: Organization;
}

/** Default configs for each step type shown in the builder form */
export const DEFAULT_STEP_CONFIGS: Record<StepType, Record<string, unknown>> = {
  llm_call: {
    model: 'llama3-8b-8192',
    system_prompt: 'You are a helpful assistant.',
    user_prompt: '',
    max_tokens: 1024,
    temperature: 0.7,
  },
  http_request: {
    url: '',
    method: 'POST',
    headers: {},
    body: {},
  },
  db_write: {
    table: '',
    fields: {},
  },
  notify: {
    channel: 'slack',
    message: 'Workflow step completed.',
  },
  conditional_branch: {
    condition: 'contains',
    value: '',
  },
  approval_gate: {
    approvers: ['owner', 'editor'],
  },
};

/** Step types that only owners can add */
export const OWNER_ONLY_STEP_TYPES: StepType[] = ['db_write', 'notify'];
