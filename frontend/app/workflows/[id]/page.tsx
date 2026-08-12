'use client';

import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'urql';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Settings, Plus } from 'lucide-react';

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

export default function WorkflowBuilder({ params }: { params: { id: string } }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  const [result] = useQuery({
    query: WORKFLOW_QUERY,
    variables: { id: params.id },
    pause: !isAuthenticated,
  });

  const [, executeTrigger] = useMutation(TRIGGER_RUN_MUTATION);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated || result.fetching) return <div className="container">Loading...</div>;
  if (result.error) return <div className="container text-danger">Error: {result.error.message}</div>;

  const workflow = result.data?.workflows_by_pk;
  if (!workflow) return <div className="container">Workflow not found.</div>;

  const handleRun = async () => {
    setIsStarting(true);
    try {
      const res = await executeTrigger({ workflow_id: workflow.id });
      if (res.error) {
        alert('Failed to start run: ' + res.error.message);
      } else {
        const runId = res.data.triggerWorkflowRun.run_id;
        router.push(`/workflows/${workflow.id}/runs/${runId}`);
      }
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="container">
      <header className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-muted"><ArrowLeft size={20} /></Link>
          <div>
            <h1 style={{ margin: 0 }}>{workflow.name}</h1>
            <p className="text-muted" style={{ margin: '4px 0 0' }}>{workflow.description}</p>
          </div>
        </div>
        <button 
          className="primary flex items-center gap-2" 
          onClick={handleRun}
          disabled={isStarting}
        >
          <Play size={16} /> {isStarting ? 'Starting...' : 'Run Workflow'}
        </button>
      </header>

      <div className="flex gap-4">
        <div style={{ flex: 2 }}>
          <div className="flex justify-between items-center mb-4">
            <h2>Steps</h2>
            <button className="flex items-center gap-2"><Plus size={16} /> Add Step</button>
          </div>
          
          <div className="flex flex-col gap-4">
            {workflow.workflow_steps.map((step: any, index: number) => (
              <div key={step.id} className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 style={{ margin: 0 }}>
                    <span className="text-muted mr-2">{index + 1}.</span> 
                    {step.step_type.toUpperCase().replace('_', ' ')}
                  </h3>
                  <Settings size={16} className="text-muted" />
                </div>
                <pre style={{ 
                  backgroundColor: 'var(--bg)', 
                  padding: '12px', 
                  borderRadius: '4px',
                  fontSize: '12px',
                  overflowX: 'auto'
                }}>
                  {JSON.stringify(step.config, null, 2)}
                </pre>
              </div>
            ))}
            {workflow.workflow_steps.length === 0 && (
              <div className="card text-muted text-center">No steps defined.</div>
            )}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h2>Triggers</h2>
          <div className="flex flex-col gap-4">
            {workflow.workflow_triggers.map((trigger: any) => (
              <div key={trigger.id} className="card">
                <h4 style={{ margin: '0 0 8px 0' }}>{trigger.trigger_type.toUpperCase()}</h4>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {JSON.stringify(trigger.config)}
                </div>
              </div>
            ))}
            {workflow.workflow_triggers.length === 0 && (
              <div className="card text-muted">No triggers attached.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
