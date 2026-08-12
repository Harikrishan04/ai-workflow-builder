'use client';

/**
 * FIX: In Next.js 15, route params is a Promise.
 * Must use React.use() in client components to unwrap it.
 * Previously: { params }: { params: { id: string } }  ← crashes in strict mode
 * Fixed:      { params }: { params: Promise<{ id: string }> }  + use(params)
 */

import { use, useState } from 'react';
import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'urql';
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Eye } from 'lucide-react';
import { useOrgRole } from '../../../hooks/useOrgRole';
import type { WorkflowStep, WorkflowTrigger } from '../../../types';

const WORKFLOW_QUERY = `
  query GetWorkflowDetails($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      org_id
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        step_type
        config
      }
      workflow_triggers {
        id
        trigger_type
        config
      }
    }
  }
`;

const TRIGGER_RUN_MUTATION = `
  mutation TriggerRun($workflow_id: uuid!) {
    triggerWorkflowRun(workflow_id: $workflow_id) {
      run_id
      status
    }
  }
`;

const STEP_TYPE_COLORS: Record<string, string> = {
  llm_call: '#7c3aed',
  http_request: '#0284c7',
  db_write: '#0891b2',
  notify: '#059669',
  conditional_branch: '#d97706',
  approval_gate: '#dc2626',
};

const STEP_TYPE_LABELS: Record<string, string> = {
  llm_call: '🧠 LLM Call',
  http_request: '🌐 HTTP Request',
  db_write: '💾 DB Write',
  notify: '🔔 Notify',
  conditional_branch: '🔀 Conditional Branch',
  approval_gate: '✋ Approval Gate',
};

export default function WorkflowBuilder({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // FIX: Unwrap params Promise with React.use()
  const { id } = use(params);

  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  // FIX: useOrgRole hook drives ALL role-gated UI
  const { canTrigger, isLoading: roleLoading, role } = useOrgRole();

  const [result] = useQuery({
    query: WORKFLOW_QUERY,
    variables: { id },
    pause: !isAuthenticated,
  });

  const [, executeTrigger] = useMutation(TRIGGER_RUN_MUTATION);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated || result.fetching || roleLoading) {
    return <div className="container" style={{ paddingTop: '60px' }}>Loading...</div>;
  }
  if (result.error) {
    return (
      <div className="container" style={{ color: 'var(--danger)', paddingTop: '60px' }}>
        Error: {result.error.message}
      </div>
    );
  }

  const workflow = result.data?.workflows_by_pk;
  if (!workflow) {
    return <div className="container" style={{ paddingTop: '60px' }}>Workflow not found.</div>;
  }

  const handleRun = async () => {
    setIsStarting(true);
    try {
      const res = await executeTrigger({ workflow_id: workflow.id });
      if (res.error) {
        alert('Failed to start run: ' + res.error.message);
      } else {
        const runId = res.data.triggerWorkflowRun.run_id;
        router.push(`/workflows/${id}/runs/${runId}`);
      }
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <header
        className="flex justify-between items-center"
        style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <ArrowLeft size={20} style={{ color: 'var(--text-muted)' }} />
          </Link>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px' }}>{workflow.name}</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
              {workflow.description}
              &nbsp;·&nbsp;
              <span style={{ textTransform: 'capitalize' }}>Your role: <strong>{role}</strong></span>
            </p>
          </div>
        </div>
        {/* FIX: Run button hidden for viewers */}
        {canTrigger ? (
          <button
            className="primary flex items-center gap-2"
            onClick={handleRun}
            disabled={isStarting}
          >
            <Play size={16} />
            {isStarting ? 'Starting...' : 'Run Workflow'}
          </button>
        ) : (
          <div
            className="flex items-center gap-2"
            style={{ fontSize: '13px', color: 'var(--text-muted)' }}
          >
            <Eye size={16} /> View Only
          </div>
        )}
      </header>

      <div className="flex gap-4">
        {/* Steps Column */}
        <div style={{ flex: 2 }}>
          <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Steps</h2>
            {canTrigger && (
              <Link href={`/workflows/${id}/edit`}>
                <button style={{ fontSize: '13px' }}>Edit Steps</button>
              </Link>
            )}
          </div>

          {/* Step Pipeline Visualization */}
          <div className="flex flex-col" style={{ gap: '0' }}>
            {workflow.workflow_steps.map((step: WorkflowStep, index: number) => (
              <div key={step.id} style={{ position: 'relative' }}>
                {/* Connector line between steps */}
                {index > 0 && (
                  <div
                    style={{
                      width: '2px',
                      height: '20px',
                      backgroundColor: 'var(--border)',
                      marginLeft: '23px',
                    }}
                  />
                )}
                <div
                  className="card flex items-center gap-4"
                  style={{
                    padding: '14px 18px',
                    borderLeft: `4px solid ${STEP_TYPE_COLORS[step.step_type] ?? 'var(--border)'}`,
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: STEP_TYPE_COLORS[step.step_type] ?? 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                      {STEP_TYPE_LABELS[step.step_type] ?? step.step_type}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(step.config, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}

            {workflow.workflow_steps.length === 0 && (
              <div
                className="card"
                style={{
                  textAlign: 'center',
                  padding: '40px',
                  color: 'var(--text-muted)',
                  borderStyle: 'dashed',
                }}
              >
                No steps defined. Click "Edit Steps" to add some.
              </div>
            )}
          </div>
        </div>

        {/* Triggers Column */}
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: '0 0 16px' }}>Triggers</h2>
          <div className="flex flex-col gap-4">
            {workflow.workflow_triggers.map((trigger: WorkflowTrigger) => (
              <div key={trigger.id} className="card" style={{ padding: '14px 18px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                  {trigger.trigger_type === 'manual' && '🖱️ Manual'}
                  {trigger.trigger_type === 'webhook' && '🔗 Webhook'}
                  {trigger.trigger_type === 'scheduled' && '⏰ Scheduled'}
                  {trigger.trigger_type === 'db_event' && '🗄️ DB Event'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {trigger.trigger_type === 'webhook' && (
                    <>API Key: <code style={{ color: 'var(--text)' }}>
                      {(trigger.config as { api_key?: string }).api_key ?? '—'}
                    </code></>
                  )}
                  {trigger.trigger_type === 'scheduled' && (
                    <>Cron: <code>{(trigger.config as { cron?: string }).cron ?? '—'}</code></>
                  )}
                </div>
              </div>
            ))}
            {workflow.workflow_triggers.length === 0 && (
              <div
                className="card"
                style={{ color: 'var(--text-muted)', fontSize: '13px', borderStyle: 'dashed' }}
              >
                No triggers attached.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
