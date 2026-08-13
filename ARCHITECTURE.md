# Architecture & Implementation Write-up

## Schema Reasoning
The data model is fundamentally designed around a strict multi-tenant hierarchy: `Organization -> Workflows -> Runs -> Step Runs`.
To ensure robust scalability and strict data isolation, all core operational tables (`workflows`, `workflow_runs`, `workflow_steps`, `step_runs`) share a direct or relational reference back to the `org_id`.

**Key Entities:**
- **organizations & org_members:** Establishes multi-tenancy and stores usage quotas. `org_members` serves as the junction table dictating a user's role (`owner`, `editor`, `viewer`) within a specific organization.
- **workflows & workflow_steps:** Represents the blueprint. `workflow_steps` stores its configuration in a dynamic `jsonb` column, allowing extreme flexibility across different node types (LLM, HTTP, Branch, etc.) without requiring rigid schema alterations. 
- **workflow_runs & step_runs:** Represents the execution state. `workflow_runs` tracks the overall lifecycle and includes a `resume_index` integer column. This is critical for the pause/resume capability, as it stores the exact index of the next step to execute once an approval gate is cleared.

## The Two-Layer Permission Model

A primary challenge in this application is that standard database-level Row Level Security (RLS) is insufficient for complex workflow orchestration. We implemented a dual-layer approach:

### Layer 1: Database RLS (Org + Role Scoping)
This layer acts as the impenetrable sandbox. Every `select`, `insert`, `update`, and `delete` operation evaluated by Hasura is filtered through the user's `X-Hasura-User-Id`. 
- An `org_members` relationship check ensures that an Editor in Org A cannot even *read* workflows belonging to Org B, effectively eliminating any risk of direct ID-guessing attacks across tenants.
- Viewers are completely blocked from inserting or updating records at the database level.
- Step-level gating is partially enforced here: Editors are explicitly denied `insert` permissions on `workflow_steps` where the type is `db_write`, `notify`, or `webhook`, restricting these powerful nodes to Owners.

### Layer 2: Application-Level Gating (Action Handlers)
Because workflows run on serverless functions with elevated admin privileges (to write to `step_runs` securely), the executor must manually re-verify trust *mid-execution*.
- When `triggerWorkflowRun` or `approveStep` is invoked, the handler extracts the caller's user ID from the session payload and queries the database to confirm their role *in the context of the workflow's specific organization*.
- This ensures that a user cannot spoof an Action payload to approve a step or trigger a run in an organization where they do not possess `owner` or `editor` privileges.

## Approval-Gate Pause/Resume Implementation

The approval gate transforms a standard synchronous execution loop into a stateful, asynchronous state machine. 

**How it works:**
1. **The Pause:** When the `trigger-workflow-run` execution loop evaluates a step of type `approval_gate`, it updates the `step_run` status to `paused` and the `workflow_run` status to `paused`. 
2. **State Preservation:** Crucially, it sets the `workflow_run.resume_index` to the array index of the *next* step in the sequence, and halts the Node.js execution completely by returning early.
3. **Real-time UI:** The Next.js frontend, listening via a GraphQL subscription, instantly reflects this state change and reveals an "Approve & Resume" button for authorized roles.
4. **The Resume:** Clicking the button fires the `approveStep` Hasura Action. This serverless function first verifies the caller's role (Layer 2 permission). Upon passing, it marks the step as `completed` (recording the approver's ID and timestamp), and then issues a synthetic HTTP `POST` internally to re-trigger the `trigger-workflow-run` endpoint. 
5. **Execution Continuation:** The executor boots up, detects a `resume_from_run_id` payload, pulls the `resume_index` and the output of the last completed step, and seamlessly restarts the `for` loop from exactly where it left off, maintaining context across the boundary.
