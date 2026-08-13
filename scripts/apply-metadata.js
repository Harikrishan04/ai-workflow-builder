/**
 * apply-metadata.js
 *
 * Applies full Hasura metadata (tables, relationships, permissions, actions)
 * directly to the running Hasura instance.
 */

const HASURA_ENDPOINT = 'https://local.hasura.local.nhost.run/v1/metadata';
const ADMIN_SECRET = 'nhost-admin-secret';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  console.log('1. Exporting existing Hasura metadata...');
  const exportRes = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      type: 'export_metadata',
      args: {},
    }),
  });

  const metadata = await exportRes.json();
  if (metadata.error) {
    throw new Error(`Export failed: ${JSON.stringify(metadata)}`);
  }

  console.log('2. Constructing table metadata...');
  const publicTables = [
    {
      table: { name: 'organizations', schema: 'public' },
      array_relationships: [
        {
          name: 'org_members',
          using: {
            foreign_key_constraint_on: {
              column: 'org_id',
              table: { name: 'org_members', schema: 'public' },
            },
          },
        },
        {
          name: 'workflows',
          using: {
            foreign_key_constraint_on: {
              column: 'org_id',
              table: { name: 'workflows', schema: 'public' },
            },
          },
        },
        {
          name: 'workflow_runs',
          using: {
            foreign_key_constraint_on: {
              column: 'org_id',
              table: { name: 'workflow_runs', schema: 'public' },
            },
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              org_members: {
                user_id: { _eq: 'X-Hasura-User-Id' },
              },
            },
            columns: ['id', 'name', 'quota_limit', 'quota_used', 'quota_reset_at', 'created_at'],
          },
        },
      ],
    },
    {
      table: { name: 'org_members', schema: 'public' },
      object_relationships: [
        {
          name: 'organization',
          using: {
            foreign_key_constraint_on: 'org_id',
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              user_id: { _eq: 'X-Hasura-User-Id' },
            },
            columns: ['id', 'org_id', 'user_id', 'role'],
          },
        },
      ],
    },
    {
      table: { name: 'workflows', schema: 'public' },
      object_relationships: [
        {
          name: 'organization',
          using: {
            foreign_key_constraint_on: 'org_id',
          },
        },
      ],
      array_relationships: [
        {
          name: 'workflow_steps',
          using: {
            foreign_key_constraint_on: {
              column: 'workflow_id',
              table: { name: 'workflow_steps', schema: 'public' },
            },
          },
        },
        {
          name: 'workflow_triggers',
          using: {
            foreign_key_constraint_on: {
              column: 'workflow_id',
              table: { name: 'workflow_triggers', schema: 'public' },
            },
          },
        },
        {
          name: 'workflow_runs',
          using: {
            foreign_key_constraint_on: {
              column: 'workflow_id',
              table: { name: 'workflow_runs', schema: 'public' },
            },
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              organization: {
                org_members: {
                  user_id: { _eq: 'X-Hasura-User-Id' },
                },
              },
            },
            columns: '*',
          },
        },
      ],
      insert_permissions: [
        {
          role: 'user',
          permission: {
            check: {
              organization: {
                org_members: {
                  _and: [
                    { user_id: { _eq: 'X-Hasura-User-Id' } },
                    { role: { _in: ['owner', 'editor'] } },
                  ],
                },
              },
            },
            set: {
              created_by: 'X-Hasura-User-Id',
            },
            columns: ['id', 'org_id', 'name', 'description'],
          },
        },
      ],
      update_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              organization: {
                org_members: {
                  _and: [
                    { user_id: { _eq: 'X-Hasura-User-Id' } },
                    { role: { _in: ['owner', 'editor'] } },
                  ],
                },
              },
            },
            check: {},
            columns: ['name', 'description', 'updated_at'],
          },
        },
      ],
      delete_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              organization: {
                org_members: {
                  _and: [
                    { user_id: { _eq: 'X-Hasura-User-Id' } },
                    { role: { _eq: 'owner' } },
                  ],
                },
              },
            },
          },
        },
      ],
    },
    {
      table: { name: 'workflow_steps', schema: 'public' },
      object_relationships: [
        {
          name: 'workflow',
          using: {
            foreign_key_constraint_on: 'workflow_id',
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow: {
                organization: {
                  org_members: {
                    user_id: { _eq: 'X-Hasura-User-Id' },
                  },
                },
              },
            },
            columns: '*',
          },
        },
      ],
      insert_permissions: [
        {
          role: 'user',
          permission: {
            check: {
              workflow: {
                organization: {
                  org_members: {
                    _and: [
                      { user_id: { _eq: 'X-Hasura-User-Id' } },
                      { role: { _in: ['owner', 'editor'] } },
                    ],
                  },
                },
              },
            },
            columns: ['id', 'workflow_id', 'step_order', 'step_type', 'config'],
          },
        },
      ],
      update_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow: {
                organization: {
                  org_members: {
                    _and: [
                      { user_id: { _eq: 'X-Hasura-User-Id' } },
                      { role: { _in: ['owner', 'editor'] } },
                    ],
                  },
                },
              },
            },
            check: {},
            columns: ['step_order', 'step_type', 'config'],
          },
        },
      ],
      delete_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow: {
                organization: {
                  org_members: {
                    _and: [
                      { user_id: { _eq: 'X-Hasura-User-Id' } },
                      { role: { _eq: 'owner' } },
                    ],
                  },
                },
              },
            },
          },
        },
      ],
    },
    {
      table: { name: 'workflow_triggers', schema: 'public' },
      object_relationships: [
        {
          name: 'workflow',
          using: {
            foreign_key_constraint_on: 'workflow_id',
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow: {
                organization: {
                  org_members: {
                    user_id: { _eq: 'X-Hasura-User-Id' },
                  },
                },
              },
            },
            columns: '*',
          },
        },
      ],
      insert_permissions: [
        {
          role: 'user',
          permission: {
            check: {
              workflow: {
                organization: {
                  org_members: {
                    _and: [
                      { user_id: { _eq: 'X-Hasura-User-Id' } },
                      { role: { _in: ['owner', 'editor'] } },
                    ],
                  },
                },
              },
            },
            columns: ['workflow_id', 'trigger_type', 'config'],
          },
        },
      ],
      delete_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow: {
                organization: {
                  org_members: {
                    _and: [
                      { user_id: { _eq: 'X-Hasura-User-Id' } },
                      { role: { _eq: 'owner' } },
                    ],
                  },
                },
              },
            },
          },
        },
      ],
    },
    {
      table: { name: 'workflow_runs', schema: 'public' },
      object_relationships: [
        {
          name: 'workflow',
          using: {
            foreign_key_constraint_on: 'workflow_id',
          },
        },
        {
          name: 'organization',
          using: {
            foreign_key_constraint_on: 'org_id',
          },
        },
      ],
      array_relationships: [
        {
          name: 'step_runs',
          using: {
            foreign_key_constraint_on: {
              column: 'run_id',
              table: { name: 'step_runs', schema: 'public' },
            },
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              organization: {
                org_members: {
                  user_id: { _eq: 'X-Hasura-User-Id' },
                },
              },
            },
            columns: '*',
          },
        },
      ],
    },
    {
      table: { name: 'step_runs', schema: 'public' },
      object_relationships: [
        {
          name: 'workflow_run',
          using: {
            foreign_key_constraint_on: 'run_id',
          },
        },
        {
          name: 'workflow_step',
          using: {
            foreign_key_constraint_on: 'step_id',
          },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: {
            filter: {
              workflow_run: {
                organization: {
                  org_members: {
                    user_id: { _eq: 'X-Hasura-User-Id' },
                  },
                },
              },
            },
            columns: '*',
          },
        },
      ],
      event_triggers: [
        {
          name: 'notify_step_completed',
          definition: {
            enable_manual: false,
            insert: { columns: '*' },
            update: { columns: ['status'] },
          },
          retry_conf: { num_retries: 3, interval_sec: 10, timeout_sec: 30 },
          webhook: '{{NHOST_FUNCTIONS_URL}}/notify-handler',
          headers: [{ name: 'x-nhost-webhook-secret', value_from_env: 'NHOST_WEBHOOK_SECRET' }],
        },
      ],
    },
  ];

  const defaultSource = metadata.sources.find((s) => s.name === 'default');
  if (!defaultSource) throw new Error('Default source not found');

  // Retain existing auth and storage tables, and merge public tables
  const existingNonPublic = defaultSource.tables.filter((t) => t.table.schema !== 'public');
  defaultSource.tables = [...existingNonPublic, ...publicTables];

  // Actions
  metadata.actions = [
    {
      name: 'triggerWorkflowRun',
      definition: {
        kind: 'synchronous',
        type: 'mutation',
        arguments: [{ name: 'workflow_id', type: 'uuid!' }],
        output_type: 'TriggerWorkflowRunOutput',
        handler: '{{NHOST_FUNCTIONS_URL}}/trigger-workflow-run',
        forward_client_headers: true,
      },
      permissions: [{ role: 'user' }],
    },
    {
      name: 'approveStep',
      definition: {
        kind: 'synchronous',
        type: 'mutation',
        arguments: [{ name: 'step_run_id', type: 'uuid!' }],
        output_type: 'ApproveStepOutput',
        handler: '{{NHOST_FUNCTIONS_URL}}/approve-step',
        forward_client_headers: true,
      },
      permissions: [{ role: 'user' }],
    },
  ];

  metadata.custom_types = {
    enums: [],
    input_objects: [],
    objects: [
      {
        name: 'TriggerWorkflowRunOutput',
        fields: [
          { name: 'run_id', type: 'uuid!' },
          { name: 'status', type: 'String!' },
        ],
      },
      {
        name: 'ApproveStepOutput',
        fields: [
          { name: 'success', type: 'Boolean!' },
          { name: 'message', type: 'String!' },
        ],
      },
    ],
    scalars: [],
  };

  metadata.cron_triggers = [
    {
      name: 'scheduled_workflow_runner',
      webhook: '{{NHOST_FUNCTIONS_URL}}/scheduled-runner',
      schedule: '* * * * *',
      include_in_metadata: true,
      payload: {},
      retry_conf: { num_retries: 2, retry_interval_seconds: 15, timeout_seconds: 30 },
      headers: [{ name: 'x-nhost-webhook-secret', value_from_env: 'NHOST_WEBHOOK_SECRET' }]
    }
  ];

  console.log('3. Applying metadata via replace_metadata...');
  const replaceRes = await fetch(HASURA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      type: 'replace_metadata',
      args: metadata,
    }),
  });

  const replaceJson = await replaceRes.json();
  if (replaceJson.error || replaceJson.is_error) {
    console.error('Failed to replace metadata:', JSON.stringify(replaceJson, null, 2));
    process.exit(1);
  }

  console.log('✅ Metadata successfully applied!');
}

main().catch((err) => {
  console.error('Error applying metadata:', err);
  process.exit(1);
});
