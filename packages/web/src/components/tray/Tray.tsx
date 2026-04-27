import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useIssues } from '../../hooks/useIssues.js';
import { ageString } from '../../labels.js';
import type { PendingDecisionPayload } from '../../types.js';

const POLL_MS = 5_000;
const RESOLVED_EVENT = 'kanbots:decision-resolved';

export interface TrayProps {
  onJump: (issueNumber: number) => void;
}

export function Tray({ onJump }: TrayProps) {
  const [items, setItems] = useState<PendingDecisionPayload[]>([]);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const { issues } = useIssues();

  const refresh = useCallback(async () => {
    try {
      const next = await api.listPendingDecisions();
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handle = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    function onResolved(): void {
      void refresh();
    }
    window.addEventListener(RESOLVED_EVENT, onResolved);
    return () => {
      window.clearInterval(handle);
      window.removeEventListener(RESOLVED_EVENT, onResolved);
    };
  }, [refresh]);

  // Re-poll when an awaiting/blocked issue changes — gives a near-real-time
  // experience without a dedicated SSE channel (Phase 12 may centralize).
  const blockedKey = issues
    .filter((i) => i.agent === 'blocked')
    .map((i) => i.number)
    .join(',');
  useEffect(() => {
    void refresh();
  }, [blockedKey, refresh]);

  if (items.length === 0 || collapsed) return null;

  async function pick(card: PendingDecisionPayload, value: string): Promise<void> {
    if (submitting !== null) return;
    setSubmitting(card.cardId);
    setError(null);
    try {
      await api.resolveCard(card.cardId, value);
      window.dispatchEvent(new CustomEvent(RESOLVED_EVENT));
      // Optimistically drop the resolved card
      setItems((prev) => prev.filter((c) => c.cardId !== card.cardId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function dismiss(card: PendingDecisionPayload): Promise<void> {
    if (submitting !== null) return;
    setSubmitting(card.cardId);
    setError(null);
    try {
      await api.dismissCard(card.cardId);
      window.dispatchEvent(new CustomEvent(RESOLVED_EVENT));
      setItems((prev) => prev.filter((c) => c.cardId !== card.cardId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="kb-tray kb-app" role="region" aria-label="Pending decisions">
      <div className="kb-tray-head">
        <span className="px" aria-hidden />
        <span className="t">Decisions awaiting you</span>
        <span className="ct">{items.length}</span>
        <button
          type="button"
          className="close"
          aria-label="Hide tray"
          title="Hide"
          onClick={() => setCollapsed(true)}
        >
          ×
        </button>
      </div>
      <div className="kb-tray-body" role="log" aria-live="polite" aria-relevant="additions">
        {items.map((item) => {
          const issue = issues.find((i) => i.number === item.issueNumber);
          const title = issue?.title ?? `issue #${item.issueNumber}`;
          return (
            <button
              key={item.cardId}
              type="button"
              className="kb-tray-item"
              onClick={() => onJump(item.issueNumber)}
            >
              <div className="kb-tray-num">
                #{item.issueNumber} · run {item.runId} · {ageString(item.createdAt)} ago
              </div>
              <div className="kb-tray-title">{title}</div>
              <div className="kb-tray-q">{item.question}</div>
              <div
                className="kb-tray-opts"
                onClick={(e) => e.stopPropagation()}
                role="group"
                aria-label="Decision options"
              >
                {item.options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="o"
                    disabled={submitting === item.cardId}
                    onClick={() => void pick(item, opt.value)}
                  >
                    {submitting === item.cardId ? '…' : opt.label}
                  </button>
                ))}
                <button
                  key="__dismiss"
                  type="button"
                  className="o dismiss"
                  disabled={submitting === item.cardId}
                  onClick={() => void dismiss(item)}
                  title="Dismiss this decision and stop the run"
                >
                  Dismiss
                </button>
              </div>
            </button>
          );
        })}
        {error ? <div className="kb-tray-error">{error}</div> : null}
      </div>
    </div>
  );
}
