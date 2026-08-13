/**
 * register-triggers.js
 * 
 * Registers event triggers and cron triggers in Hasura metadata.
 * Run once after metadata is applied.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const HASURA_URL = 'https://local.hasura.local.nhost.run/v1/metadata';
const ADMIN_SECRET = 'nhost-admin-secret';

async function hasuraMetadata(body) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  // 1. Event Trigger: notify_step_completed
  console.log('1. Creating event trigger: notify_step_completed...');
  const et1 = await hasuraMetadata({
    type: 'pg_create_event_trigger',
    args: {
      name: 'notify_step_completed',
      source: 'default',
      table: { name: 'step_runs', schema: 'public' },
      webhook: '{{NHOST_FUNCTIONS_URL}}/notify-handler',
      insert: { columns: '*' },
      update: { columns: ['status'] },
      retry_conf: {
        num_retries: 3,
        interval_sec: 10,
        timeout_sec: 30,
      },
      headers: [
        { name: 'x-nhost-webhook-secret', value_from_env: 'NHOST_WEBHOOK_SECRET' },
      ],
    },
  });
  console.log('   Result:', et1.message || JSON.stringify(et1));

  // 2. Cron Trigger: scheduled_workflow_runner
  console.log('2. Creating cron trigger: scheduled_workflow_runner...');
  const ct1 = await hasuraMetadata({
    type: 'create_cron_trigger',
    args: {
      name: 'scheduled_workflow_runner',
      webhook: '{{NHOST_FUNCTIONS_URL}}/scheduled-runner',
      schedule: '* * * * *',
      include_in_metadata: true,
      payload: {},
      retry_conf: {
        num_retries: 2,
        retry_interval_seconds: 15,
        timeout_seconds: 30,
      },
      headers: [
        { name: 'x-nhost-webhook-secret', value_from_env: 'NHOST_WEBHOOK_SECRET' },
      ],

    },
  });
  console.log('   Result:', ct1.message || JSON.stringify(ct1));

  console.log('\n✅ All triggers registered!');
}

main().catch(console.error);
