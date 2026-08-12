# AI Agent Workflow Builder

A mini n8n purpose-built for chaining AI agent steps. Full-stack assignment built with **nhost + Hasura + PostgreSQL + Next.js**.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + TypeScript |
| Backend | nhost (Postgres + Hasura + Auth + Functions) |
| GraphQL | Hasura GraphQL Engine (queries, mutations, subscriptions) |
| LLM | Groq API (`llama3-8b-8192`) |
| Auth | nhost Auth (JWT with org/role claims) |
| Deploy | Vercel (frontend) + nhost Cloud (backend) |

## Features

- 🔗 **6 Step Types** — `llm_call`, `http_request`, `db_write`, `notify`, `conditional_branch`, `approval_gate`
- ⚡ **4 Trigger Types** — Manual, Webhook, Scheduled (cron), Database Event
- 🔐 **Two Permission Layers** — Hasura row-level (org isolation) + Action handler re-checks (step-level gating)
- 📡 **Live Subscriptions** — per-step run status via GraphQL WebSocket, no refresh
- ⏸️ **Pause/Resume** — approval gate pauses execution; owner/editor approves to continue
- 🏢 **Cross-org Isolation** — Org B cannot see or touch Org A data, even with correct UUIDs

## Local Setup

### Prerequisites

- Docker + Docker Compose
- Node.js 18+
- [nhost CLI](https://docs.nhost.io/cli)

### 1. Clone the repo

```bash
git clone https://github.com/Harikrishan04/ai-workflow-builder.git
cd ai-workflow-builder
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Fill in: GROQ_API_KEY, SLACK_WEBHOOK_URL (optional)
```

### 3. Start the nhost local stack

```bash
nhost up
```

This starts:
- **Postgres** on `localhost:5432`
- **Hasura Console** on `http://localhost:1337`
- **GraphQL API** on `http://localhost:1337/v1/graphql`
- **nhost Functions** on `http://localhost:1337/v1/functions`

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

## Environment Variables

```env
# nhost (local dev — auto-set by nhost CLI)
NHOST_SUBDOMAIN=local
NHOST_REGION=local

# nhost Cloud (production)
NEXT_PUBLIC_NHOST_SUBDOMAIN=your-subdomain
NEXT_PUBLIC_NHOST_REGION=eu-central-1

# LLM
GROQ_API_KEY=your-groq-api-key

# Notify (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

## Project Structure

```
.
├── nhost/
│   ├── migrations/          # PostgreSQL migrations
│   └── metadata/            # Hasura tables, permissions, actions, triggers
├── functions/               # nhost serverless Action handlers (TypeScript)
│   ├── trigger-workflow-run.ts
│   ├── approve-step.ts
│   ├── webhook-trigger.ts
│   ├── notify-handler.ts
│   ├── scheduled-runner.ts
│   └── _utils/
├── frontend/                # Next.js App Router
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
└── README.md
```

## Permission Architecture

### Layer 1 — Hasura Row-Level Permissions
Every permission filter joins through `org_members` — an Org B token cannot retrieve Org A rows even with correct UUIDs.

### Layer 2 — Action Handler Re-checks
`triggerWorkflowRun` and `approveStep` handlers re-query `org_members` from the DB using the session `user_id`. The role from the JWT session variable is **never trusted alone** for state-changing operations.

## Approval Gate Flow

1. Executor hits `approval_gate` step → sets `workflow_runs.status = 'paused'`, records `resume_index`
2. Live subscription shows paused state immediately
3. Owner/Editor clicks **Approve** → calls `approveStep` Action
4. Handler re-checks role from DB → marks step complete → resumes execution from `resume_index`

## Deployment

- **Frontend**: Deployed on [Vercel](https://vercel.com) — see live URL: `[TBD]`
- **Backend**: Hosted on [nhost Cloud](https://nhost.io)
- Migrations + metadata are checked in and applied via `nhost deploy`

## Seed Data

```bash
# Create two test orgs with users and roles
cd nhost
psql $DATABASE_URL -f seeds/seed.sql
```

## License

MIT
