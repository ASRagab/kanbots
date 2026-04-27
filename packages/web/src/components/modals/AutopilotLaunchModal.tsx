import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { listPersonas, type Persona } from '../../personas.js';

export interface AutopilotLaunchModalProps {
  onClose: () => void;
  onStarted?: (result: { sessionId: number; issueNumber: number }) => void;
}

type Tab = 'feature-dev' | 'qa';

export function AutopilotLaunchModal({ onClose, onStarted }: AutopilotLaunchModalProps) {
  const [tab, setTab] = useState<Tab>('feature-dev');
  const [personas, setPersonas] = useState<Persona[]>(() => listPersonas());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => personas.filter((p) => selectedIds.has(p.id)),
    [personas, selectedIds],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  function refreshPersonas(): void {
    setPersonas(listPersonas());
  }

  function toggle(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start(): Promise<void> {
    if (tab !== 'feature-dev') return;
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.startAutopilot({
        kind: 'feature-dev',
        config: {
          kind: 'feature-dev',
          personas: selected.map((p) => ({ id: p.id, name: p.name, prompt: p.prompt })),
        },
      });
      onStarted?.(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="kb-modal-scrim kb-app" onClick={onClose} role="dialog" aria-modal="true">
      <div className="kb-modal sm" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="kb-modal-head">
          <span className="crumb-chip">
            <b>kanbots</b>
          </span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <h2>Start an autopilot</h2>
          <span className="grow" />
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="kb-modal-body" style={{ display: 'block', overflowY: 'auto' }}>
          <div style={{ padding: '14px 22px 0' }}>
            <div className="kb-tdm-tabs" style={{ marginBottom: 18 }}>
              <button
                type="button"
                className={`kb-tdm-tab${tab === 'feature-dev' ? ' active' : ''}`}
                onClick={() => setTab('feature-dev')}
              >
                Feature dev
              </button>
              <button
                type="button"
                className={`kb-tdm-tab${tab === 'qa' ? ' active' : ''}`}
                onClick={() => setTab('qa')}
              >
                QA <span style={{ color: 'var(--ink-4)', fontSize: 10, marginLeft: 6 }}>soon</span>
              </button>
            </div>
          </div>

          <div style={{ padding: '0 22px 18px' }}>
            {tab === 'feature-dev' ? (
              <FeatureDevTab
                personas={personas}
                selectedIds={selectedIds}
                onToggle={toggle}
                onPersonasChanged={refreshPersonas}
              />
            ) : (
              <QaComingSoon />
            )}
          </div>
        </div>

        <div className="kb-modal-foot">
          {tab === 'feature-dev' ? (
            <span className="hint">
              {selected.length === 0
                ? 'Pick one or more personas.'
                : `Round-robin across ${selected.length} persona${selected.length === 1 ? '' : 's'}. The loop runs until you stop it.`}
            </span>
          ) : null}
          <span className="grow" />
          {error ? (
            <span style={{ color: 'var(--failed)', fontSize: 11, marginRight: 8 }}>{error}</span>
          ) : null}
          <button
            type="button"
            className="kb-btn ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          {tab === 'feature-dev' ? (
            <button
              type="button"
              className="kb-btn primary"
              disabled={selected.length === 0 || submitting}
              onClick={() => void start()}
              style={{ marginLeft: 8 }}
            >
              {submitting
                ? 'Starting…'
                : `Start autopilot${selected.length > 0 ? ` (${selected.length})` : ''}`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FeatureDevTab({
  personas,
  selectedIds,
  onToggle,
  onPersonasChanged,
}: {
  personas: Persona[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onPersonasChanged: () => void;
}) {
  return (
    <>
      <div style={{ color: 'var(--ink-2)', fontSize: 12.5, marginBottom: 12 }}>
        Pick one or more personas. The autopilot will cycle through them in order, ideating and shipping
        one feature at a time, until you stop it.
      </div>
      <div className="kb-persona-grid">
        {personas.map((p) => {
          const isSelected = selectedIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`kb-persona-card${isSelected ? ' selected' : ''}`}
              onClick={() => onToggle(p.id)}
              title={p.prompt}
              aria-pressed={isSelected}
            >
              <div className="kb-persona-emoji" aria-hidden>
                {p.emoji}
              </div>
              <div className="kb-persona-name">{p.name}</div>
              <div className="kb-persona-tagline">{p.tagline}</div>
              {isSelected ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 10,
                    fontSize: 11,
                    color: 'var(--accent)',
                  }}
                  aria-hidden
                >
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)' }}>
        Need a different perspective?{' '}
        <button
          type="button"
          className="kb-btn ghost"
          style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={onPersonasChanged}
        >
          Refresh personas
        </button>{' '}
        — create custom ones from the Suggest feature flow on the Backlog column.
      </div>
    </>
  );
}

function QaComingSoon() {
  return (
    <div
      style={{
        padding: '24px 16px',
        textAlign: 'center',
        color: 'var(--ink-3)',
        fontSize: 12.5,
        border: '1px dashed var(--hairline)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 6 }}>
        QA autopilot — coming soon
      </div>
      <div>
        Will run code-level checks (typecheck/tests/lint/build) and live UI testing against this workspace,
        filing a bug ticket and dispatching an agent for each failure it finds.
      </div>
    </div>
  );
}
