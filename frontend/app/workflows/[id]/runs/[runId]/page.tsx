'use client';

import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useSubscription, useMutation } from 'urql';
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, XCircle, Clock, Loader, PauseCircle } from 'lucide-react';

const STEP_RUNS_SUBSCRIPTION = `
  subscription MonitorRun($run_id: uuid!) {
    step_runs(
      where: { run_id: { _eq: $run_id } }
      order_by: { step_order: asc }
    ) {
      id
      step_order
      status
      input
      output
      error
      attempt_count
      workflow_step {
        step_type
        config
      }
    }
    workflow_runs_by_pk(id: $run_id) {
      status
      started_at
      finished_at
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

export default function RunMonitor({ params }: { params: { id: string, runId: string } }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  const [subResult] = useSubscription({
    query: STEP_RUNS_SUBSCRIPTION,
    variables: { run_id: params.runId },
    pause: !isAuthenticated,
  });

  const [, executeApprove] = useMutation(APPROVE_STEP_MUTATION);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) return <div className="container">Loading...</div>;
  if (subResult.error) return <div className="container text-danger">Subscription error: {subResult.error.message}</div>;

  const stepRuns = subResult.data?.step_runs || [];
  const runStatus = subResult.data?.workflow_runs_by_pk?.status;

  const handleApprove = async (stepRunId: string) => {
    const res = await executeApprove({ step_run_id: stepRunId });
    if (res.error) {
      alert('Failed to approve: ' + res.error.message);
    }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch(status) {
      case 'completed': return <CheckCircle size={20} className="text-success" color="var(--success)" />;
      case 'failed': return <XCircle size={20} className="text-danger" color="var(--danger)" />;
      case 'running': return <Loader size={20} className="text-primary" style={{ animation: 'spin 1s linear infinite' }} />;
      case 'paused': return <PauseCircle size={20} color="#e3b341" />;
      default: return <Clock size={20} className="text-muted" />;
    }
  };

  return (
    <div className="container">
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <Link href={`/workflows/${params.id}`} className="text-muted"><ArrowLeft size={20} /></Link>
          <div>
            <h1 style={{ margin: 0 }}>Run Status</h1>
            <p className="text-muted" style={{ margin: '4px 0 0' }}>ID: {params.runId}</p>
          </div>
        </div>
        <div className="card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Overall Status: <strong>{runStatus?.toUpperCase() || 'CONNECTING...'}</strong>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        {stepRuns.map((stepRun: any) => (
          <div 
            key={stepRun.id} 
            className="card"
            style={{ 
              borderLeft: stepRun.status === 'paused' ? '4px solid #e3b341' : 
                          stepRun.status === 'failed' ? '4px solid var(--danger)' : 
                          '1px solid var(--border)' 
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <StatusIcon status={stepRun.status} />
                <h3 style={{ margin: 0 }}>
                  {stepRun.step_order}. {stepRun.workflow_step.step_type.toUpperCase().replace('_', ' ')}
                </h3>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {stepRun.status === 'running' && stepRun.attempt_count > 1 
                  ? `Attempt ${stepRun.attempt_count}` 
                  : stepRun.status.toUpperCase()}
              </span>
            </div>

            {stepRun.status === 'paused' && stepRun.workflow_step.step_type === 'approval_gate' && (
              <div className="mb-4 p-4" style={{ backgroundColor: 'rgba(227, 179, 65, 0.1)', borderRadius: '6px' }}>
                <p style={{ margin: '0 0 12px 0', color: '#e3b341' }}>
                  <strong>Approval Required</strong><br/>
                  This step paused the workflow. A user with the Owner or Editor role in this organization must approve it to continue.
                </p>
                <button 
                  className="primary" 
                  style={{ backgroundColor: '#e3b341', borderColor: '#e3b341', color: '#000' }}
                  onClick={() => handleApprove(stepRun.id)}
                >
                  Approve & Resume
                </button>
              </div>
            )}

            {stepRun.error && (
              <div className="mb-4 p-4" style={{ backgroundColor: 'rgba(218, 54, 51, 0.1)', color: 'var(--danger)', borderRadius: '6px' }}>
                <strong>Error:</strong> {stepRun.error}
              </div>
            )}

            {(stepRun.input || stepRun.output) && (
              <div className="flex gap-4">
                {stepRun.input && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', marginBottom: '4px' }} className="text-muted">INPUT</div>
                    <pre style={{ backgroundColor: 'var(--bg)', padding: '8px', borderRadius: '4px', fontSize: '12px', overflowX: 'auto', margin: 0 }}>
                      {JSON.stringify(stepRun.input, null, 2)}
                    </pre>
                  </div>
                )}
                {stepRun.output && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', marginBottom: '4px' }} className="text-muted">OUTPUT</div>
                    <pre style={{ backgroundColor: 'var(--bg)', padding: '8px', borderRadius: '4px', fontSize: '12px', overflowX: 'auto', margin: 0 }}>
                      {JSON.stringify(stepRun.output, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {stepRuns.length === 0 && (
          <div className="card text-muted text-center" style={{ padding: '40px' }}>
            Waiting for steps to start...
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
