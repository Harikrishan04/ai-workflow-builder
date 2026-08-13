'use client';

/**
 * FIX: params is a Promise in Next.js 15 — must use React.use() to unwrap.
 * ALSO: Approve button now hidden from viewers via useOrgRole.
 */

import { use } from 'react';
import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useSubscription, useMutation } from 'urql';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, Clock, Loader2, PauseCircle, SkipForward } from 'lucide-react';
import { useOrgRole } from '../../../../../hooks/useOrgRole';
import type { StepRun, RunStatus } from '../../../../../types';

const STEP_RUNS_SUBSCRIPTION = `
  subscription MonitorRun($run_id: uuid!) {
    workflow_runs_by_pk(id: $run_id) {
      id
      status
      started_at
      finished_at
      step_runs(order_by: { step_order: asc }) {
        id
        step_order
        status
        input
        output
        error
        attempt_count
        approved_by
        approved_at
        workflow_step {
          step_type
          config
        }
      }
    }
  }
`;

const APPROVE_STEP_MUTATION = `
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      message
    }
  }
`;

const RUN_STATUS_STYLES: Record<RunStatus, { color: string; label: string }> = {
  pending:   { color: 'var(--text-muted)', label: 'Pending' },
  running:   { color: 'var(--primary)',    label: 'Running' },
  paused:    { color: '#e3b341',           label: 'Paused — Awaiting Approval' },
  completed: { color: 'var(--success)',    label: 'Completed ✓' },
  failed:    { color: 'var(--danger)',     label: 'Failed ✗' },
  cancelled: { color: 'var(--text-muted)', label: 'Cancelled' },
};

function StatusIcon({ status }: { status: string }) {
  const iconProps = { size: 20, strokeWidth: 2 };
  switch (status) {
    case 'completed': return <CheckCircle {...iconProps} color="var(--success)" />;
    case 'failed':    return <XCircle {...iconProps} color="var(--danger)" />;
    case 'skipped':   return <SkipForward {...iconProps} color="var(--text-muted)" />;
    case 'running':   return (
      <Loader2
        {...iconProps}
        color="var(--primary)"
        style={{ animation: 'spin 1s linear infinite' }}
      />
    );
    case 'paused':    return <PauseCircle {...iconProps} color="#e3b341" />;
    default:          return <Clock {...iconProps} color="var(--text-muted)" />;
  }
}

export default function RunMonitor({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  // FIX: Unwrap params Promise with React.use()
  const { id, runId } = use(params);

  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  // FIX: Role-aware approve button
  const { canApprove, isLoading: roleLoading } = useOrgRole();

  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [subResult] = useSubscription({
    query: STEP_RUNS_SUBSCRIPTION,
    variables: { run_id: runId },
    pause: !isAuthenticated,
  });

  const [, executeApprove] = useMutation(APPROVE_STEP_MUTATION);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated || roleLoading) {
    return <div className="container" style={{ paddingTop: '60px' }}>Loading...</div>;
  }
  if (subResult.error) {
    return (
      <div className="container" style={{ color: 'var(--danger)', paddingTop: '60px' }}>
        Subscription error: {subResult.error.message}
      </div>
    );
  }

  const run = subResult.data?.workflow_runs_by_pk;
  const stepRuns: StepRun[] = run?.step_runs ?? [];
  const runStatus: RunStatus = run?.status ?? 'pending';
  const statusStyle = RUN_STATUS_STYLES[runStatus];

  const handleApprove = async (stepRunId: string) => {
    setApprovingId(stepRunId);
    try {
      const res = await executeApprove({ step_run_id: stepRunId });
      if (res.error) {
        alert('Failed to approve: ' + res.error.message);
      }
    } finally {
      setApprovingId(null);
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
          <Link href={`/workflows/${id}`}>
            <ArrowLeft size={20} style={{ color: 'var(--text-muted)' }} />
          </Link>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px' }}>Run Monitor</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'monospace' }}>
              {runId}
            </p>
          </div>
        </div>

        {/* Overall run status pill */}
        <div
          style={{
            padding: '6px 16px',
            borderRadius: '20px',
            border: `1px solid ${statusStyle.color}`,
            color: statusStyle.color,
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: `${statusStyle.color}18`,
          }}
        >
          {statusStyle.label}
        </div>
      </header>

      {/* Step Cards */}
      <div className="flex flex-col" style={{ gap: '0' }}>
        {stepRuns.map((stepRun: StepRun, index: number) => (
          <div key={stepRun.id} style={{ position: 'relative' }}>
            {/* Connector */}
            {index > 0 && (
              <div
                style={{
                  width: '2px',
                  height: '16px',
                  backgroundColor:
                    stepRun.status === 'completed' ? 'var(--success)' : 'var(--border)',
                  marginLeft: '23px',
                }}
              />
            )}

            <div
              className="card"
              style={{
                borderLeft: `4px solid ${
                  stepRun.status === 'completed' ? 'var(--success)' :
                  stepRun.status === 'failed'    ? 'var(--danger)' :
                  stepRun.status === 'paused'    ? '#e3b341' :
                  stepRun.status === 'running'   ? 'var(--primary)' :
                  'var(--border)'
                }`,
                opacity: stepRun.status === 'skipped' ? 0.5 : 1,
              }}
            >
              {/* Step Header */}
              <div className="flex justify-between items-center" style={{ marginBottom: '12px' }}>
                <div className="flex items-center gap-4">
                  <StatusIcon status={stepRun.status} />
                  <div>
                    <strong style={{ fontSize: '14px' }}>
                      Step {stepRun.step_order}: {stepRun.workflow_step.step_type
                        .toUpperCase()
                        .replace(/_/g, ' ')}
                    </strong>
                    {stepRun.attempt_count > 1 && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          backgroundColor: 'var(--surface-hover)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        Retry {stepRun.attempt_count - 1}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {stepRun.status.toUpperCase()}
                </span>
              </div>

              {/* Approval Gate UI — hidden from viewers */}
              {stepRun.status === 'paused' &&
                stepRun.workflow_step.step_type === 'approval_gate' && (
                <div
                  style={{
                    backgroundColor: 'rgba(227,179,65,0.08)',
                    border: '1px solid #e3b341',
                    borderRadius: '6px',
                    padding: '16px',
                    marginBottom: '12px',
                  }}
                >
                  <p style={{ margin: '0 0 12px', color: '#e3b341', fontSize: '13px' }}>
                    <strong>⏸ Approval Required</strong>
                    <br />
                    The workflow is paused at this step. An owner or editor must approve to continue.
                  </p>
                  {/* FIX: Approve button hidden for viewers */}
                  {canApprove ? (
                    <button
                      onClick={() => handleApprove(stepRun.id)}
                      disabled={approvingId === stepRun.id}
                      style={{
                        backgroundColor: '#e3b341',
                        borderColor: '#e3b341',
                        color: '#000',
                        fontWeight: 600,
                      }}
                    >
                      {approvingId === stepRun.id ? 'Approving...' : '✓ Approve & Resume'}
                    </button>
                  ) : (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                      You are a viewer and cannot approve this step.
                    </p>
                  )}
                </div>
              )}

              {/* Error */}
              {stepRun.error && (
                <div
                  style={{
                    backgroundColor: 'rgba(218,54,51,0.08)',
                    border: '1px solid var(--danger)',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    marginBottom: '12px',
                    fontSize: '13px',
                    color: 'var(--danger)',
                  }}
                >
                  <strong>Error:</strong> {stepRun.error}
                </div>
              )}

              {/* Input / Output */}
              {(stepRun.input || stepRun.output) && (
                <div className="flex gap-4" style={{ marginTop: '8px' }}>
                  {stepRun.input && (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Input
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          backgroundColor: 'var(--bg)',
                          padding: '10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          overflowX: 'auto',
                          maxHeight: '150px',
                          overflowY: 'auto',
                        }}
                      >
                        {JSON.stringify(stepRun.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {stepRun.output && (
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Output
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          backgroundColor: 'var(--bg)',
                          padding: '10px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          overflowX: 'auto',
                          maxHeight: '150px',
                          overflowY: 'auto',
                        }}
                      >
                        {JSON.stringify(stepRun.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {stepRuns.length === 0 && (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}
          >
            <Loader2
              size={32}
              style={{ animation: 'spin 1s linear infinite', marginBottom: '12px', color: 'var(--primary)' }}
            />
            <p style={{ margin: 0 }}>Waiting for steps to start...</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
