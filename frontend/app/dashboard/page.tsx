'use client';

import { useAuthenticationStatus, useSignOut, useUserData } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from 'urql';
import Link from 'next/link';
import { LogOut, Plus } from 'lucide-react';

const WORKFLOWS_QUERY = `
  query GetWorkflows {
    workflows(order_by: { updated_at: desc }) {
      id
      name
      description
      updated_at
      organization {
        name
        quota_this_month {
          calls_used
          calls_allowed
        }
      }
      workflow_runs(limit: 1, order_by: { created_at: desc }) {
        status
        created_at
      }
    }
  }
`;

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signOut } = useSignOut();
  const router = useRouter();

  const [result] = useQuery({
    query: WORKFLOWS_QUERY,
    pause: !isAuthenticated,
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) return <div className="container">Loading...</div>;

  const { data, fetching, error } = result;
  
  // We extract quota from the first workflow's organization since Layer 1 
  // ensures we only see workflows from our org. (A real app would query it separately).
  const org = data?.workflows?.[0]?.organization;

  return (
    <div className="container">
      <header className="flex justify-between items-center mb-4">
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>Welcome, {user?.email}</p>
        </div>
        <button onClick={() => signOut()} className="flex items-center gap-2">
          <LogOut size={16} /> Sign Out
        </button>
      </header>

      {org && (
        <div className="card mb-4 flex items-center justify-between" style={{ backgroundColor: 'rgba(35, 134, 54, 0.1)', borderColor: 'var(--success)' }}>
          <div>
            <strong>Organization: {org.name}</strong>
          </div>
          <div>
            Quota: {org.quota_this_month?.calls_used} / {org.quota_this_month?.calls_allowed} calls used
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-4 mb-4">
        <h2>Your Workflows</h2>
        <Link href="/workflows/new">
          <button className="primary flex items-center gap-2">
            <Plus size={16} /> New Workflow
          </button>
        </Link>
      </div>

      {fetching && <p>Loading workflows...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Error: {error.message}</p>}

      {data?.workflows?.length === 0 && (
        <div className="card text-muted" style={{ textAlign: 'center', padding: '40px' }}>
          No workflows found. Create your first workflow to get started.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {data?.workflows?.map((wf: any) => (
          <div key={wf.id} className="card flex justify-between items-center">
            <div>
              <h3 style={{ margin: '0 0 8px 0' }}>{wf.name}</h3>
              <p className="text-muted" style={{ margin: 0, fontSize: '14px' }}>
                {wf.description || 'No description'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {wf.workflow_runs?.[0] && (
                <span className="text-muted" style={{ fontSize: '12px' }}>
                  Last run: <strong>{wf.workflow_runs[0].status}</strong>
                </span>
              )}
              <Link href={`/workflows/${wf.id}`}>
                <button>Open Builder</button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
