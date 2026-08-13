
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

  console.log('2. Waiting for step to reach paused state (approval gate)...');
  let stepRuns = [];
  let pausedStep = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const runRes = await graphql(`
      query GetRun($runId: uuid!) {
        step_runs(where: { run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
          id
          step_order
          status
          output
          error
        }
      }
    `, { runId });

    stepRuns = runRes.data.step_runs;
    console.log(`Poll ${i+1}: ${stepRuns.map(s => `${s.step_order}=${s.status}`).join(', ')}`);
    
    pausedStep = stepRuns.find(s => s.status === 'paused');
    if (pausedStep) break;
  }

  if (!pausedStep) {
    console.error('Workflow did not reach paused state!');
    console.log(JSON.stringify(stepRuns, null, 2));
    return;
  }

  console.log(`\n3. Reached Approval Gate. Output from previous step:`, stepRuns[0].output);
  console.log(`Approving step ${pausedStep.id}...`);

  const approveRes = await graphql(`
    mutation ApproveStep($id: uuid!) {
      approveStep(step_run_id: $id) {
        success
        message
      }
    }
  `, { id: pausedStep.id });

  if (approveRes.errors) {
    console.error('Approve Error:', JSON.stringify(approveRes.errors, null, 2));
    return;
  }

  console.log('Approval success!', approveRes.data.approveStep);

  console.log('4. Waiting for workflow to complete...');
  for (let i = 0; i < 15; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const runRes = await graphql(`
      query GetRun($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          status
        }
        step_runs(where: { run_id: { _eq: $runId } }, order_by: { step_order: asc }) {
          id
          step_order
          status
          output
          error
        }
      }
    `, { runId });

    const runStatus = runRes.data.workflow_runs_by_pk.status;
    stepRuns = runRes.data.step_runs;
    
    console.log(`Poll ${i+1}: Workflow=${runStatus}, Steps=${stepRuns.map(s => `${s.step_order}=${s.status}`).join(', ')}`);
    
    if (runStatus === 'completed' || runStatus === 'failed') break;
  }
  
  console.log('\nFinal Step Runs:');
  console.log(JSON.stringify(stepRuns, null, 2));
}

main().catch(console.error);
