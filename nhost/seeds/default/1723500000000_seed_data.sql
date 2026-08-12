-- Insert 3 test users (password is 'password123')
INSERT INTO auth.users (id, email, password_hash, default_role, active, email_verified, locale) VALUES
('11111111-1111-1111-1111-111111111111', 'owner@orga.com', '$2a$10$M90.N1oG6p6Y2G2R6G2KGuR.gV7M0.w3Z5M6M6M6M6M6M6M6M6M6M', 'user', true, true, 'en'),
('22222222-2222-2222-2222-222222222222', 'editor@orga.com', '$2a$10$M90.N1oG6p6Y2G2R6G2KGuR.gV7M0.w3Z5M6M6M6M6M6M6M6M6M6M', 'user', true, true, 'en'),
('33333333-3333-3333-3333-333333333333', 'owner@orgb.com', '$2a$10$M90.N1oG6p6Y2G2R6G2KGuR.gV7M0.w3Z5M6M6M6M6M6M6M6M6M6M', 'user', true, true, 'en')
ON CONFLICT DO NOTHING;

-- Insert user roles
INSERT INTO auth.user_roles (user_id, role) VALUES
('11111111-1111-1111-1111-111111111111', 'user'),
('22222222-2222-2222-2222-222222222222', 'user'),
('33333333-3333-3333-3333-333333333333', 'user')
ON CONFLICT DO NOTHING;

-- Organizations
INSERT INTO organizations (id, name) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A - The AI Company'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B - Stealth Startup')
ON CONFLICT DO NOTHING;

-- Members
INSERT INTO org_members (org_id, user_id, role) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'editor'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'owner')
ON CONFLICT DO NOTHING;

-- Sample Workflow for Org A
INSERT INTO workflows (id, org_id, name, description, created_by) VALUES
('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Lead Enrichment & Slack Notify', 'Extracts info from an email and pauses for approval', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

-- Workflow Steps
INSERT INTO workflow_steps (workflow_id, step_order, step_type, config) VALUES
('10000000-0000-0000-0000-000000000001', 1, 'llm_call', '{"model": "llama3-8b-8192", "user_prompt": "Analyze this lead: Hello, I want to buy your enterprise product.", "system_prompt": "Extract the sentiment (Positive/Negative)."}'),
('10000000-0000-0000-0000-000000000001', 2, 'approval_gate', '{"approvers": ["owner", "editor"]}'),
('10000000-0000-0000-0000-000000000001', 3, 'conditional_branch', '{"condition": "contains", "value": "Positive"}'),
('10000000-0000-0000-0000-000000000001', 4, 'http_request', '{"url": "https://echo.free.beeceptor.com", "method": "POST", "body": {"sentiment": "{{previousOutput}}"}}')
ON CONFLICT DO NOTHING;

-- Triggers
INSERT INTO workflow_triggers (workflow_id, trigger_type, config) VALUES
('10000000-0000-0000-0000-000000000001', 'webhook', '{"api_key": "secret-lead-key"}')
ON CONFLICT DO NOTHING;
