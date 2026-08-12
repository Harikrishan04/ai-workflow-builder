'use client';

/**
 * /workflows/new — Create a new workflow with steps
 *
 * This page was completely missing in the Gemini implementation.
 * The dashboard's "New Workflow" button linked here but got a 404.
 *
 * Features:
 *  - Name + description inputs
 *  - Dynamic step list: add/remove steps with type + config
 *  - Owner-only step types blocked for editors (mirrors Layer 1 DB rule)
 *  - Submit mutation: insert workflow + nested steps in one call
 */

import { useState, useEffect } from 'react';
import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useOrgRole } from '../../../hooks/useOrgRole';
import {
  type StepType,
  DEFAULT_STEP_CONFIGS,
  OWNER_ONLY_STEP_TYPES,
} from '../../../types';

const ALL_STEP_TYPES: StepType[] = [
  'llm_call',
  'http_request',
  'db_write',
  'notify',
  'conditional_branch',
  'approval_gate',
];

const STEP_LABELS: Record<StepType, string> = {
  llm_call: '🧠 LLM Call',
  http_request: '🌐 HTTP Request',
  db_write: '💾 DB Write (Owner only)',
  notify: '🔔 Notify (Owner only)',
  conditional_branch: '🔀 Conditional Branch',
  approval_gate: '✋ Approval Gate',
};

const CREATE_WORKFLOW_MUTATION = `
  mutation CreateWorkflow(
    $name: String!
    $description: String
    $orgId: uuid!
    $steps: [workflow_steps_insert_input!]!
  ) {
    insert_workflows_one(object: {
      name: $name
      description: $description
      org_id: $orgId
      workflow_steps: { data: $steps }
    }) {
      id
    }
  }
`;

interface DraftStep {
  step_type: StepType;
  config: Record<string, unknown>;
}

export default function NewWorkflow() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();
  const { orgId, canTrigger, canAddRestrictedSteps, isLoading: roleLoading } = useOrgRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, executeCreate] = useMutation(CREATE_WORKFLOW_MUTATION);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
    // Redirect viewers — they cannot create workflows
    if (!roleLoading && !canTrigger) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, isLoading, canTrigger, roleLoading, router]);

  const addStep = (type: StepType) => {
    setSteps((prev) => [
      ...prev,
      {
        step_type: type,
        config: { ...DEFAULT_STEP_CONFIGS[type] },
      },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStepConfig = (index: number, configStr: string) => {
    try {
      const parsed = JSON.parse(configStr);
      setSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, config: parsed } : s))
      );
    } catch {
      // Invalid JSON while typing — ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) { setError('Organization not found'); return; }
    if (!name.trim()) { setError('Workflow name is required'); return; }

    setIsSubmitting(true);
    setError(null);

    const stepsPayload = steps.map((s, i) => ({
      step_order: i + 1,
      step_type: s.step_type,
      config: s.config,
    }));

    const res = await executeCreate({
      name: name.trim(),
      description: description.trim() || null,
      orgId,
      steps: stepsPayload,
    });

    setIsSubmitting(false);

    if (res.error) {
      setError(res.error.message);
    } else {
      const newId = res.data.insert_workflows_one.id;
      router.push(`/workflows/${newId}`);
    }
  };

  if (isLoading || roleLoading) {
    return <div className="container" style={{ paddingTop: '60px' }}>Loading...</div>;
  }

  return (
    <div className="container" style={{ maxWidth: '800px' }}>
      {/* Header */}
      <header
        className="flex items-center gap-4"
        style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}
      >
        <Link href="/dashboard">
          <ArrowLeft size={20} style={{ color: 'var(--text-muted)' }} />
        </Link>
        <h1 style={{ margin: 0, fontSize: '20px' }}>New Workflow</h1>
      </header>

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <h2 style={{ margin: '0 0 16px' }}>Details</h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="wf-name" style={{ fontSize: '14px', fontWeight: 500 }}>
                Workflow Name <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                id="wf-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lead Enrichment Pipeline"
                style={{ width: '100%' }}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="wf-desc" style={{ fontSize: '14px', fontWeight: 500 }}>
                Description
              </label>
              <textarea
                id="wf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
          </div>
        </div>

        {/* Steps Builder */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
            <h2 style={{ margin: 0 }}>Steps</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {steps.length} step{steps.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Existing Steps */}
          {steps.map((step, index) => (
            <div
              key={index}
              className="card"
              style={{ marginBottom: '12px', borderLeft: '4px solid var(--primary)' }}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: '10px' }}>
                <strong style={{ fontSize: '14px' }}>
                  {index + 1}. {STEP_LABELS[step.step_type]}
                </strong>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  style={{ padding: '4px 8px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Config (JSON)
              </label>
              <textarea
                defaultValue={JSON.stringify(step.config, null, 2)}
                onChange={(e) => updateStepConfig(index, e.target.value)}
                rows={5}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
              />
            </div>
          ))}

          {/* Add Step Buttons */}
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '10px' }}>
              Add a step:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {ALL_STEP_TYPES.map((type) => {
                const isRestricted = OWNER_ONLY_STEP_TYPES.includes(type);
                const disabled = isRestricted && !canAddRestrictedSteps;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addStep(type)}
                    disabled={disabled}
                    title={disabled ? 'Only owners can add this step type' : undefined}
                    style={{
                      fontSize: '12px',
                      padding: '6px 12px',
                      opacity: disabled ? 0.4 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Plus size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    {STEP_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'rgba(218,54,51,0.08)',
              border: '1px solid var(--danger)',
              borderRadius: '6px',
              padding: '12px 16px',
              color: 'var(--danger)',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <button type="submit" className="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Workflow'}
          </button>
          <Link href="/dashboard">
            <button type="button">Cancel</button>
          </Link>
        </div>
      </form>
    </div>
  );
}
