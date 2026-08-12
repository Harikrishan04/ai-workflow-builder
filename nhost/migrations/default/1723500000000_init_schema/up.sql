-- Organizations
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  quota_limit   int  NOT NULL DEFAULT 1000,
  quota_used    int  NOT NULL DEFAULT 0,
  quota_reset_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Members
CREATE TABLE org_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, -- references auth.users(id) from nhost
  role    text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  UNIQUE(org_id, user_id)
);

-- Workflows
CREATE TABLE workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Workflow Steps
CREATE TABLE workflow_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_order   int  NOT NULL,
  step_type    text NOT NULL CHECK (step_type IN (
                  'llm_call','http_request','db_write',
                  'notify','conditional_branch','approval_gate')),
  config       jsonb NOT NULL DEFAULT '{}',
  UNIQUE(workflow_id, step_order)
);

-- Triggers
CREATE TABLE workflow_triggers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN (
                  'manual','webhook','scheduled','db_event')),
  config       jsonb NOT NULL DEFAULT '{}'
);

-- Runs
CREATE TYPE run_status AS ENUM (
  'pending','running','paused','completed','failed','cancelled'
);
CREATE TABLE workflow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   uuid NOT NULL REFERENCES workflows(id),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  status        run_status NOT NULL DEFAULT 'pending',
  trigger_type  text,
  resume_index  int NOT NULL DEFAULT 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Step Runs
CREATE TYPE step_run_status AS ENUM (
  'pending','running','paused','completed','failed','skipped'
);
CREATE TABLE step_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id       uuid NOT NULL REFERENCES workflow_steps(id),
  step_order    int  NOT NULL,
  status        step_run_status NOT NULL DEFAULT 'pending',
  input         jsonb,
  output        jsonb,
  error         text,
  attempt_count int  NOT NULL DEFAULT 0,
  approved_by   uuid,
  approved_at   timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz
);

-- Indexes for performance
CREATE INDEX idx_org_members_user  ON org_members(user_id);
CREATE INDEX idx_org_members_org   ON org_members(org_id);
CREATE INDEX idx_step_runs_run_id  ON step_runs(run_id);
CREATE INDEX idx_workflow_runs_wf  ON workflow_runs(workflow_id);
CREATE INDEX idx_steps_workflow    ON workflow_steps(workflow_id, step_order);
