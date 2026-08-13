const HASURA_ENDPOINT = 'https://local.graphql.local.nhost.run/v1';
const ADMIN_SECRET = 'nhost-admin-secret';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function graphql(query, variables) {
  const res = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function main() {
  const workflowId = '10000000-0000-0000-0000-000000000001';

  // Update Step 1 to return Positive for testing the true branch
  await graphql(`
    mutation {
      update_workflow_steps(
        where: { step_type: { _eq: "llm_call" } }
        _set: {
          config: {
            model: "llama-3.1-8b-instant",
            system_prompt: "You are a sales analyst. Respond with exactly one word: Positive, Negative, or Neutral.",
            user_prompt: "Respond with the single word Positive.",
            max_tokens: 10
          }
        }
      ) { affected_rows }
    }
  `);

  console.log('1. Triggering workflow run...');
  const triggerRes = await graphql(`
    mutation TriggerRun($id: uuid!) {
      triggerWorkflowRun(workflow_id: $id) {
        run_id
        status
      }
    }
  `, { id: workflowId });

  if (triggerRes.errors) {
    console.error('Trigger Error:', JSON.stringify(triggerRes.errors, null, 2));
    return;
  }

  const runId = triggerRes.data.triggerWorkflowRun.run_id;
  console.log(`Run started with ID: ${runId}`);

  console.log('2. Waiting for approval gate...');
  let pausedStep = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await graphql(`
      query GetRun($runId: uuid!) {
        step_runs(where: { run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
          id step_order status output
        }
      }
    `, { runId });
    const steps = res.data.step_runs;
    console.log(`Poll ${i+1}: ${steps.map(s => `${s.step_order}=${s.status}`).join(', ')}`);
    pausedStep = steps.find(s => s.status === 'paused');
    if (pausedStep) break;
  }

  if (!pausedStep) {
    console.error('Did not pause!');
    return;
  }

  console.log('3. Approving step...');
  await graphql(`
    mutation Approve($id: uuid!) {
      approveStep(step_run_id: $id) { success message }
    }
  `, { id: pausedStep.id });

  console.log('4. Waiting for completion (including HTTP step)...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await graphql(`
      query GetRun($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) { status }
        step_runs(where: { run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
          id step_order status output error
        }
      }
    `, { runId });
    const runStatus = res.data.workflow_runs_by_pk.status;
    const steps = res.data.step_runs;
    console.log(`Poll ${i+1}: Workflow=${runStatus}, Steps=${steps.map(s => `${s.step_order}=${s.status}`).join(', ')}`);
    if (runStatus === 'completed' || runStatus === 'failed') {
      console.log('\nFinal Steps:', JSON.stringify(steps, null, 2));
      break;
    }
  }
}

main().catch(console.error);
