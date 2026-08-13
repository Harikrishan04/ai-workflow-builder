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
  console.log('Run started with ID:', triggerRes.data.triggerWorkflowRun.run_id);
}

main().catch(console.error);
