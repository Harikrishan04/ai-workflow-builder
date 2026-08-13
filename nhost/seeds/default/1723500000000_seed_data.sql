-- =============================================================================
-- SEED DATA — AI Workflow Builder
--
-- IMPORTANT: Do NOT insert auth.users directly via SQL.
-- nhost manages the auth schema via its auth service. Direct SQL inserts
-- bypass password hashing and auth triggers, making those users unloggable.
--
-- Instead, create users via one of:
--   1. nhost local dashboard:  http://localhost:1337 → Auth → Users → Add
--   2. The seed script:        node scripts/create-seed-users.js
--   3. nhost Cloud console:    Your project → Auth → Users → Invite
--
-- After creating users, copy their UUIDs and paste them below where indicated.
-- =============================================================================

-- STEP 1: Replace these placeholder UUIDs with the real UUIDs from your auth users.
-- You get these from the Hasura console: Auth → Users, or from the seed script output.
DO $$
DECLARE
  owner_a_id uuid := '4b0de5aa-5567-4b66-ac93-112fdf6c43d7'; -- owner@orga.com
  editor_a_id uuid := '41c79085-0b3b-4e3a-8833-55f45d345a96'; -- editor@orga.com
  owner_b_id uuid := '59e97b4a-26ad-48f9-84cc-07fefe5579e0'; -- owner@orgb.com

  org_a_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  org_b_id uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_workflow_id uuid := '10000000-0000-0000-0000-000000000001';
BEGIN

-- Organizations
INSERT INTO organizations (id, name, quota_limit)
VALUES
  (org_a_id, 'Org A — The AI Company', 1000),
  (org_b_id, 'Org B — Stealth Startup', 500)
ON CONFLICT (id) DO NOTHING;

-- Org Members
INSERT INTO org_members (org_id, user_id, role)
VALUES
  (org_a_id, owner_a_id, 'owner'),
  (org_a_id, editor_a_id, 'editor'),
  (org_b_id, owner_b_id, 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Demo Workflow for Org A (3 step types + approval gate)
INSERT INTO workflows (id, org_id, name, description, created_by)
VALUES (
  v_workflow_id,
  org_a_id,
  'Lead Enrichment Pipeline',
  'Calls Groq LLM for sentiment, pauses for approval, branches on result, then fires HTTP request',
  owner_a_id
)
ON CONFLICT (id) DO NOTHING;

-- Steps
INSERT INTO workflow_steps (workflow_id, step_order, step_type, config)
VALUES
  -- Step 1: LLM sentiment analysis
  (v_workflow_id, 1, 'llm_call', jsonb_build_object(
    'model', 'llama-3.1-8b-instant',
    'system_prompt', 'You are a sales analyst. Respond with exactly one word: Positive, Negative, or Neutral.',
    'user_prompt', 'Analyze this lead message: "Hi, I saw your product at the conference and I am very interested in the enterprise plan."',
    'max_tokens', 10
  )),
  -- Step 2: Human approval gate
  (v_workflow_id, 2, 'approval_gate', jsonb_build_object(
    'approvers', jsonb_build_array('owner', 'editor'),
    'message', 'Review the LLM sentiment result before proceeding'
  )),
  -- Step 3: Branch based on LLM output
  (v_workflow_id, 3, 'conditional_branch', jsonb_build_object(
    'condition', 'contains',
    'value', 'Positive'
  )),
  -- Step 4: HTTP call to echo endpoint (demonstrates real external call)
  (v_workflow_id, 4, 'http_request', jsonb_build_object(
    'url', 'https://echo.free.beeceptor.com',
    'method', 'POST',
    'body', jsonb_build_object(
      'action', 'create_lead',
      'sentiment', '{{previousOutput}}'
    )
  ))
ON CONFLICT (workflow_id, step_order) DO NOTHING;

-- Webhook trigger for the workflow
INSERT INTO workflow_triggers (workflow_id, trigger_type, config)
VALUES (
  v_workflow_id,
  'webhook',
  jsonb_build_object('api_key', 'secret-lead-key-change-me')
)
ON CONFLICT DO NOTHING;

END $$;
