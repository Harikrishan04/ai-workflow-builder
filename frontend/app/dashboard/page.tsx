'use client';

import { useAuthenticationStatus, useSignOut, useUserData } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from 'urql';
import Link from 'next/link';
import { LogOut, Plus, Zap } from 'lucide-react';
import { useOrgRole } from '../../hooks/useOrgRole';
import type { Workflow } from '../../types';

/**
 * FIX: Query org info directly from org_members so quota
 * is always visible even when there are zero workflows.
 * Previously it was extracted from workflows[0] which broke
 * on empty orgs.
 */
const DASHBOARD_QUERY = `
  query GetDashboard {
    org_members {
      role
      organization {
        id
        name
        quota_used
        quota_limit
        quota_reset_at
        workflows(order_by: { updated_at: desc }) {
          id
          name
          description
          updated_at
          workflow_runs(limit: 1, order_by: { created_at: desc }) {
            id
            status
            created_at
          }
        }
      }
    }
  }
`;

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--success)',
  failed: 'var(--danger)',
  running: 'var(--primary)',
  paused: '#e3b341',
  pending: 'var(--text-muted)',
};

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signOut } = useSignOut();
  const router = useRouter();
  const { canTrigger } = useOrgRole();

  const [result] = useQuery({
    query: DASHBOARD_QUERY,
    pause: !isAuthenticated,
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', marginTop: '100px' }}>
        Loading...
      </div>
    );
  }

  const { data, fetching, error } = result;
  const membership = data?.org_members?.[0];
  const org = membership?.org;
  const workflows: Workflow[] = membership?.organization?.workflows ?? [];
  const quotaUsed = membership?.organization?.quota_used ?? 0;
  const quotaLimit = membership?.organization?.quota_limit ?? 1;
  const quotaPct = Math.round((quotaUsed / quotaLimit) * 100);

  return (
    <div className="container">
      {/* Header */}
      <header
        className="flex justify-between items-center"
        style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <Zap size={28} color="var(--primary)" />
          <div>
            <h1 style={{ margin: 0, fontSize: '22px' }}>AI Workflow Builder</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
              {user?.email} &nbsp;·&nbsp; {membership?.organization?.name}
            </p>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2"
          style={{ fontSize: '13px' }}
        >
          <LogOut size={14} /> Sign Out
        </button>
      </header>

      {/* Quota Banner — always shown, even with zero workflows */}
      {membership && (
        <div
          className="card flex justify-between items-center"
          style={{ marginBottom: '24px', padding: '16px 20px' }}
        >
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Monthly API Quota
            </div>
            <strong style={{ fontSize: '16px' }}>
              {quotaUsed} / {quotaLimit} calls used
            </strong>
          </div>
          <div style={{ width: '200px' }}>
            <div
              style={{
                height: '8px',
                backgroundColor: 'var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(quotaPct, 100)}%`,
                  backgroundColor: quotaPct > 90 ? 'var(--danger)' : 'var(--primary)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
              {quotaPct}% used
            </div>
          </div>
        </div>
      )}

      {/* Workflows Header */}
      <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Workflows</h2>
        {/* FIX: Only owners/editors can create workflows */}
        {canTrigger && (
          <Link href="/workflows/new">
            <button className="primary flex items-center gap-2">
              <Plus size={16} /> New Workflow
            </button>
          </Link>
        )}
      </div>

      {fetching && <p style={{ color: 'var(--text-muted)' }}>Loading workflows...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Error: {error.message}</p>}

      {!fetching && workflows.length === 0 && (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}
        >
          <Zap size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <p style={{ margin: 0 }}>No workflows yet. Create your first one to get started.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {workflows.map((wf: Workflow) => {
          const lastRun = wf.workflow_runs?.[0];
          return (
            <div
              key={wf.id}
              className="card flex justify-between items-center"
              style={{ padding: '16px 20px' }}
            >
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px' }}>{wf.name}</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  {wf.description || 'No description'}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {lastRun && (
                  <span
                    style={{
                      fontSize: '12px',
                      color: STATUS_COLORS[lastRun.status] ?? 'var(--text-muted)',
                      fontWeight: 600,
                    }}
                  >
                    ● {lastRun.status.toUpperCase()}
                  </span>
                )}
                <Link href={`/workflows/${wf.id}`}>
                  <button style={{ fontSize: '13px', padding: '6px 14px' }}>Open</button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
