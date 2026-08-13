'use client';

/**
 * Workflow Edit Page — Drag-reorder steps, add/remove/configure steps.
 * Only accessible by owners and editors.
 */

import { use, useState, useCallback } from 'react';
import { useAuthenticationStatus } from '@nhost/nextjs';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'urql';
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, GripVertical, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useOrgRole } from '../../../../hooks/useOrgRole';

const WORKFLOW_QUERY = `
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id name description org_id
      workflow_steps(order_by: { step_order: asc }) {
        id step_order step_type config
      }
    }
  }
`;

const DELETE_STEP = `
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) { id }
  }
`;

const INSERT_STEP = `
  mutation InsertStep($object: workflow_steps_insert_input!) {
    insert_workflow_steps_one(object: $object) { id step_order step_type config }
  }
`;

const UPDATE_STEP = `
  mutation UpdateStep($id: uuid!, $config: jsonb!, $step_order: Int!) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: { config: $config, step_order: $step_order }
    ) { id }
  }
`;

const UPDATE_WORKFLOW = `
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String!) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, updated_at: "now()" }
    ) { id }
  }
`;

const STEP_TYPES = [
  { value: 'llm_call', label: '🧠 LLM Call', color: '#7c3aed' },
  { value: 'http_request', label: '🌐 HTTP Request', color: '#0284c7' },
  { value: 'conditional_branch', label: '🔀 Conditional Branch', color: '#d97706' },
  { value: 'approval_gate', label: '✋ Approval Gate', color: '#dc2626' },
  { value: 'db_write', label: '💾 DB Write', color: '#0891b2', ownerOnly: true },
  { value: 'notify', label: '🔔 Notify', color: '#059669', ownerOnly: true },
];

interface StepLocal {
  id?: string;
  step_order: number;
  step_type: string;
  config: Record<string, unknown>;
  isNew?: boolean;
  expanded?: boolean;
}

function defaultConfig(stepType: string): Record<string, unknown> {
  switch (stepType) {
    case 'llm_call':
      return { model: 'llama-3.1-8b-instant', system_prompt: '', user_prompt: '', max_tokens: 1024 };
    case 'http_request':
      return { url: '', method: 'GET', headers: {}, body: {} };
    case 'conditional_branch':
      return { condition: 'contains', value: '' };
    case 'approval_gate':
      return { approvers: ['owner', 'editor'], message: '' };
    case 'db_write':
      return { table: '', fields: {} };
    case 'notify':
      return { channel: 'slack', message: '' };
    default:
      return {};
  }
}

function StepConfigEditor({
  step,
  onChange,
}: {
  step: StepLocal;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const config = step.config;

  if (step.step_type === 'llm_call') {
    return (
      <div className="flex flex-col gap-3">
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Model
          <input
            value={(config.model as string) || ''}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
            placeholder="llama-3.1-8b-instant"
            style={{ marginTop: '4px' }}
          />
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          System Prompt
          <textarea
            value={(config.system_prompt as string) || ''}
            onChange={(e) => onChange({ ...config, system_prompt: e.target.value })}
            rows={2}
            style={{ marginTop: '4px', resize: 'vertical' }}
          />
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          User Prompt
          <textarea
            value={(config.user_prompt as string) || ''}
            onChange={(e) => onChange({ ...config, user_prompt: e.target.value })}
            rows={3}
            style={{ marginTop: '4px', resize: 'vertical' }}
          />
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Max Tokens
          <input
            type="number"
            value={(config.max_tokens as number) || 1024}
            onChange={(e) => onChange({ ...config, max_tokens: parseInt(e.target.value) || 1024 })}
            style={{ marginTop: '4px', width: '120px' }}
          />
        </label>
      </div>
    );
  }

  if (step.step_type === 'http_request') {
    return (
      <div className="flex flex-col gap-3">
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          URL
          <input
            value={(config.url as string) || ''}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            placeholder="https://api.example.com/endpoint"
            style={{ marginTop: '4px' }}
          />
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Method
          <select
            value={(config.method as string) || 'GET'}
            onChange={(e) => onChange({ ...config, method: e.target.value })}
            style={{ marginTop: '4px' }}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Body (JSON)
          <textarea
            value={typeof config.body === 'object' ? JSON.stringify(config.body, null, 2) : ''}
            onChange={(e) => {
              try { onChange({ ...config, body: JSON.parse(e.target.value) }); } catch { /* ignore */ }
            }}
            rows={3}
            style={{ marginTop: '4px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
          />
        </label>
      </div>
    );
  }

  if (step.step_type === 'conditional_branch') {
    return (
      <div className="flex flex-col gap-3">
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Condition
          <select
            value={(config.condition as string) || 'contains'}
            onChange={(e) => onChange({ ...config, condition: e.target.value })}
            style={{ marginTop: '4px' }}
          >
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="llm_classify">LLM Classify</option>
          </select>
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Value
          <input
            value={(config.value as string) || ''}
            onChange={(e) => onChange({ ...config, value: e.target.value })}
            placeholder="e.g. Positive"
            style={{ marginTop: '4px' }}
          />
        </label>
      </div>
    );
  }

  if (step.step_type === 'approval_gate') {
    return (
      <div className="flex flex-col gap-3">
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Message
          <input
            value={(config.message as string) || ''}
            onChange={(e) => onChange({ ...config, message: e.target.value })}
            placeholder="Review the output before proceeding"
            style={{ marginTop: '4px' }}
          />
        </label>
      </div>
    );
  }

  if (step.step_type === 'notify') {
    return (
      <div className="flex flex-col gap-3">
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Channel
          <select
            value={(config.channel as string) || 'slack'}
            onChange={(e) => onChange({ ...config, channel: e.target.value })}
            style={{ marginTop: '4px' }}
          >
            <option value="slack">Slack</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Message
          <textarea
            value={(config.message as string) || ''}
            onChange={(e) => onChange({ ...config, message: e.target.value })}
            rows={2}
            style={{ marginTop: '4px', resize: 'vertical' }}
          />
        </label>
      </div>
    );
  }

  // db_write or fallback
  return (
    <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
      Config (JSON)
      <textarea
        value={JSON.stringify(config, null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)); } catch { /* ignore */ }
        }}
        rows={4}
        style={{ marginTop: '4px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
      />
    </label>
  );
}

export default function WorkflowEdit({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();
  const { canTrigger, isLoading: roleLoading, isOwner } = useOrgRole();

  const [result, reexecute] = useQuery({
    query: WORKFLOW_QUERY,
    variables: { id },
    pause: !isAuthenticated,
  });

  const [, deleteStep] = useMutation(DELETE_STEP);
  const [, insertStep] = useMutation(INSERT_STEP);
  const [, updateStep] = useMutation(UPDATE_STEP);
  const [, updateWorkflow] = useMutation(UPDATE_WORKFLOW);

  const [steps, setSteps] = useState<StepLocal[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Init local state from server data
  useEffect(() => {
    if (result.data?.workflows_by_pk && !initialized) {
      const wf = result.data.workflows_by_pk;
      setName(wf.name);
      setDescription(wf.description || '');
      setSteps(
        wf.workflow_steps.map((s: StepLocal) => ({
          ...s,
          expanded: false,
        }))
      );
      setInitialized(true);
    }
  }, [result.data, initialized]);

  const moveStep = useCallback((index: number, direction: 'up' | 'down') => {
    setSteps((prev) => {
      const next = [...prev];
      const swapIdx = direction === 'up' ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  }, []);

  const addStep = useCallback((stepType: string) => {
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length + 1,
        step_type: stepType,
        config: defaultConfig(stepType),
        isNew: true,
        expanded: true,
      },
    ]);
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  }, []);

  const updateConfig = useCallback((index: number, config: Record<string, unknown>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, config } : s))
    );
  }, []);

  const toggleExpand = useCallback((index: number) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, expanded: !s.expanded } : s))
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Update workflow name/description
      await updateWorkflow({ id, name, description });

      // 2. Delete removed steps (old steps not in current list)
      const wf = result.data?.workflows_by_pk;
      const currentIds = new Set(steps.filter((s) => s.id).map((s) => s.id));
      for (const old of wf?.workflow_steps || []) {
        if (!currentIds.has(old.id)) {
          await deleteStep({ id: old.id });
        }
      }

      // 3. Insert new steps / update existing
      for (const step of steps) {
        if (step.isNew || !step.id) {
          await insertStep({
            object: {
              workflow_id: id,
              step_order: step.step_order,
              step_type: step.step_type,
              config: step.config,
            },
          });
        } else {
          await updateStep({
            id: step.id,
            config: step.config,
            step_order: step.step_order,
          });
        }
      }

      // 4. Refetch and go back
      reexecute({ requestPolicy: 'network-only' });
      router.push(`/workflows/${id}`);
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !isAuthenticated || result.fetching || roleLoading) {
    return <div className="container" style={{ paddingTop: '60px' }}>Loading...</div>;
  }

  if (!canTrigger) {
    return (
      <div className="container" style={{ paddingTop: '60px', color: 'var(--danger)' }}>
        You don&apos;t have permission to edit this workflow.
      </div>
    );
  }

  const workflow = result.data?.workflows_by_pk;
  if (!workflow) {
    return <div className="container" style={{ paddingTop: '60px' }}>Workflow not found.</div>;
  }

  const stepTypeInfo = (type: string) => STEP_TYPES.find((t) => t.value === type);

  return (
    <div className="container">
      {/* Header */}
      <header
        className="flex justify-between items-center"
        style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <Link href={`/workflows/${id}`}>
            <ArrowLeft size={20} style={{ color: 'var(--text-muted)' }} />
          </Link>
          <h1 style={{ margin: 0, fontSize: '20px' }}>Edit Workflow</h1>
        </div>
        <button
          className="primary flex items-center gap-2"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </header>

      {/* Workflow Info */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '24px' }}>
        <div className="flex flex-col gap-3">
          <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Workflow Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ marginTop: '4px', fontSize: '16px', fontWeight: 600 }}
            />
          </label>
          <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ marginTop: '4px' }}
            />
          </label>
        </div>
      </div>

      {/* Steps */}
      <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Steps ({steps.length})</h2>
      </div>

      <div className="flex flex-col" style={{ gap: '0', marginBottom: '24px' }}>
        {steps.map((step, index) => {
          const info = stepTypeInfo(step.step_type);
          return (
            <div key={step.id || `new-${index}`} style={{ position: 'relative' }}>
              {index > 0 && (
                <div
                  style={{
                    width: '2px',
                    height: '12px',
                    backgroundColor: 'var(--border)',
                    marginLeft: '23px',
                  }}
                />
              )}
              <div
                className="card"
                style={{
                  padding: '0',
                  borderLeft: `4px solid ${info?.color ?? 'var(--border)'}`,
                  overflow: 'hidden',
                }}
              >
                {/* Step header — clickable to expand */}
                <div
                  className="flex items-center gap-3"
                  style={{ padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => toggleExpand(index)}
                >
                  <GripVertical size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: info?.color ?? 'var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {index + 1}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: '14px', flex: 1 }}>
                    {info?.label ?? step.step_type}
                  </span>

                  {/* Move buttons */}
                  <button
                    onClick={(e) => { e.stopPropagation(); moveStep(index, 'up'); }}
                    disabled={index === 0}
                    style={{ padding: '4px', opacity: index === 0 ? 0.3 : 1 }}
                    title="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveStep(index, 'down'); }}
                    disabled={index === steps.length - 1}
                    style={{ padding: '4px', opacity: index === steps.length - 1 ? 0.3 : 1 }}
                    title="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                    style={{ padding: '4px', color: 'var(--danger)' }}
                    title="Remove step"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Expanded config editor */}
                {step.expanded && (
                  <div
                    style={{
                      padding: '0 16px 16px',
                      borderTop: '1px solid var(--border)',
                      paddingTop: '12px',
                    }}
                  >
                    <StepConfigEditor
                      step={step}
                      onChange={(config) => updateConfig(index, config)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {steps.length === 0 && (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', borderStyle: 'dashed' }}
          >
            No steps yet. Add one below.
          </div>
        )}
      </div>

      {/* Add Step Buttons */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-muted)' }}>
          Add Step
        </h3>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {STEP_TYPES.filter((t) => !t.ownerOnly || isOwner).map((type) => (
            <button
              key={type.value}
              onClick={() => addStep(type.value)}
              className="flex items-center gap-2"
              style={{
                fontSize: '13px',
                padding: '8px 14px',
                borderColor: type.color,
                color: type.color,
              }}
            >
              <Plus size={14} />
              {type.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
