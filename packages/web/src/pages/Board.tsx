import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ArchiveModal } from '../components/modals/ArchiveModal.js';
import { AutopilotLaunchModal } from '../components/modals/AutopilotLaunchModal.js';
import { CardPreview } from '../components/Card.js';
import { Column } from '../components/Column.js';
import { PersonaPickerModal } from '../components/modals/PersonaPickerModal.js';
import { SentrySettingsModal } from '../components/modals/SentrySettingsModal.js';
import { useBoardAgentStreams } from '../hooks/useBoardAgentStreams.js';
import { useBoardFilters } from '../hooks/useBoardFilters.js';
import { useFetch } from '../hooks/useFetch.js';
import { useIssues, dispatchIssuesRefetch } from '../hooks/useIssues.js';
import { useSelection } from '../hooks/useSelection.js';
import { COLUMNS, withStatus } from '../labels.js';
import type { Persona } from '../personas.js';
import type { Issue, StatusKey } from '../types.js';

const STATUS_KEYS: readonly StatusKey[] = ['backlog', 'todo', 'inProgress', 'review', 'done'];

function issueNumberFromDragId(id: UniqueIdentifier): number | null {
  if (typeof id !== 'string' || !id.startsWith('card:')) return null;
  const n = Number.parseInt(id.slice(5), 10);
  return Number.isFinite(n) ? n : null;
}

function statusFromDropId(id: UniqueIdentifier): StatusKey | null | undefined {
  if (typeof id !== 'string' || !id.startsWith('col:')) return undefined;
  const rest = id.slice(4);
  if (rest === 'inbox') return null;
  return (STATUS_KEYS as readonly string[]).includes(rest) ? (rest as StatusKey) : undefined;
}

interface GroupedIssues {
  byKey: Record<StatusKey, Issue[]>;
  untagged: Issue[];
}

function groupByStatus(issues: Issue[]): GroupedIssues {
  const grouped: GroupedIssues = {
    byKey: { backlog: [], todo: [], inProgress: [], review: [], done: [] },
    untagged: [],
  };
  for (const issue of issues) {
    if (issue.status === null) {
      grouped.untagged.push(issue);
    } else {
      grouped.byKey[issue.status].push(issue);
    }
  }
  // Inbox order: unreviewed (no sentryMeta or sentryMeta.status === 'imported')
  // first, analyzed last. Manual entries treated as unreviewed since they
  // also need attention. Ties broken by createdAt desc.
  grouped.untagged.sort((a, b) => {
    const aReviewed = a.sentryMeta?.status === 'analyzed';
    const bReviewed = b.sentryMeta?.status === 'analyzed';
    if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    return bt - at;
  });
  return grouped;
}

const searchIcon = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const plusIcon = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const archiveBoxIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 5h18v4H3z" />
    <path d="M5 9v10h14V9" />
    <path d="M10 13h4" />
  </svg>
);

const settingsIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export interface BoardProps {
  onOpenDetail?: (issueNumber: number) => void;
  onOpenCreate?: () => void;
  onOpenPalette?: () => void;
}

export function Board({ onOpenDetail, onOpenCreate, onOpenPalette }: BoardProps = {}) {
  const { data: config } = useFetch('config', () => api.config());
  const { issues, loading, error, mutate } = useIssues();
  const { data: costToday, refetch: refetchCostToday } = useFetch('cost:today', () =>
    api.costToday(),
  );
  const { data: costUsage, refetch: refetchCostUsage } = useFetch('cost:usage', () =>
    api.costUsage(),
  );
  const filterApi = useBoardFilters(issues);

  // Poll the usage meters once a minute. The backend caches OAuth /usage for
  // 60s anyway, so polling faster just thrashes the renderer for no extra
  // freshness. Pause when the tab is hidden so a background window doesn't
  // burn requests.
  useEffect(() => {
    let cancelled = false;
    function tick(): void {
      if (cancelled) return;
      if (typeof document === 'undefined' || !document.hidden) {
        void refetchCostUsage();
        void refetchCostToday();
      }
    }
    const id = window.setInterval(tick, 60_000);
    function onVisibility(): void {
      if (!document.hidden) tick();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refetchCostUsage, refetchCostToday]);

  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [autopilotLaunchOpen, setAutopilotLaunchOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sentrySettingsOpen, setSentrySettingsOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useSelection();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const list = filterApi.filtered;
  const activeRunIds = useMemo(
    () => list.filter((i) => i.activeRun !== null).map((i) => i.activeRun!.id),
    [list],
  );
  const liveByRun = useBoardAgentStreams(activeRunIds);

  if (loading && issues.length === 0) {
    return (
      <div className="kb-app" style={{ padding: 32, color: 'var(--ink-2)' }}>
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="kb-app" style={{ padding: 32 }}>
        <h2 style={{ color: 'var(--ink)', fontSize: 16, marginBottom: 12 }}>
          Failed to load issues
        </h2>
        <pre style={{ color: 'var(--failed)' }}>{error.message}</pre>
      </div>
    );
  }

  const grouped = groupByStatus(list);
  const activeIssue =
    activeNumber !== null ? (issues.find((i) => i.number === activeNumber) ?? null) : null;

  const stats = {
    issues: list.length,
    runs: list.filter((i) => i.agent === 'running').length,
    awaiting: list.filter((i) => i.agent === 'blocked').length,
    costToday: costToday?.totalUsd ?? 0,
  };

  function onDragStart(event: DragStartEvent): void {
    const n = issueNumberFromDragId(event.active.id);
    setActiveNumber(n);
  }

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    setActiveNumber(null);
    const { active, over } = event;
    if (!over) return;

    const issueNumber = issueNumberFromDragId(active.id);
    if (issueNumber === null) return;

    const targetStatus = statusFromDropId(over.id);
    if (targetStatus === undefined) return;

    const current = list.find((i) => i.number === issueNumber);
    if (!current) return;
    if (current.status === targetStatus) return;

    const fromStatus = current.status;
    const nextLabels = withStatus(current.labels, targetStatus);
    const before = list;

    mutate((prev) =>
      (prev ?? []).map((i) =>
        i.number === issueNumber ? { ...i, status: targetStatus, labels: nextLabels } : i,
      ),
    );

    try {
      const updated = await api.updateIssue(issueNumber, { labels: nextLabels });
      mutate((prev) => (prev ?? []).map((i) => (i.number === issueNumber ? updated : i)));
      setMoveError(null);
    } catch (err) {
      mutate(before);
      const message = err instanceof Error ? err.message : String(err);
      setMoveError(`Couldn't move #${issueNumber}: ${message}`);
      return;
    }

    if (targetStatus === 'inProgress' && current.activeRun == null) {
      try {
        await api.dispatchIssue(issueNumber, { fromStatus });
        dispatchIssuesRefetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMoveError(`Moved #${issueNumber}, but couldn't start an agent: ${message}`);
      }
    }
  }

  function openPersonaPicker(): void {
    if (suggesting) return;
    setPersonaPickerOpen(true);
  }

  async function runSuggestionWith(persona: Persona): Promise<void> {
    setPersonaPickerOpen(false);
    if (suggesting) return;
    setSuggesting(true);
    setMoveError(null);
    try {
      const drafted = await api.suggestFeature(persona.prompt);
      await api.createIssue({
        title: drafted.title,
        body: drafted.body,
        labels: ['status:backlog', 'type:feat'],
      });
      dispatchIssuesRefetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMoveError(`Couldn't suggest a feature: ${message}`);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="kb-board-toolbar">
        <div className="kb-crumbs">
          {config ? (
            <>
              <span>{config.mode === 'local' ? config.repo : `${config.owner}/${config.repo}`}</span>
              <span className="kb-sep">/</span>
            </>
          ) : null}
          <span className="kb-crumb-active">Board</span>
        </div>
        <div className="kb-toolbar-actions">
          <button
            type="button"
            className="kb-search"
            onClick={() => onOpenPalette?.()}
            aria-label="Open command palette"
          >
            {searchIcon}
            <span>Search issues, branches, agents…</span>
            <span className="kb-search-kbd">⌘K</span>
          </button>
          <button
            type="button"
            className="kb-btn ghost"
            onClick={() => setArchiveOpen(true)}
            title="Browse archived tasks"
          >
            {archiveBoxIcon} Archive
          </button>
          <button
            type="button"
            className="kb-btn ghost"
            onClick={() => setAutopilotLaunchOpen(true)}
            title="Start an autopilot session"
          >
            Autopilot
          </button>
          <button
            type="button"
            className="kb-btn ghost"
            onClick={() => setSentrySettingsOpen(true)}
            title="Sentry integration settings"
            aria-label="Sentry settings"
          >
            {settingsIcon}
          </button>
          <button
            type="button"
            className="kb-btn primary"
            onClick={() => onOpenCreate?.()}
          >
            {plusIcon} New task <span className="kb-kbd">N</span>
          </button>
        </div>
      </div>
      <div className="kb-filter-row">
        <span className="kb-pill on" title="Only open issues are loaded">
          <span className="kb-pill-x" />
          Open
        </span>
        <button
          type="button"
          className={`kb-pill${filterApi.filters.hasAgent ? ' on kb-pill-running' : ''}`}
          onClick={filterApi.toggleHasAgent}
          aria-pressed={filterApi.filters.hasAgent}
        >
          {filterApi.filters.hasAgent ? <span className="kb-pill-x" /> : null}
          Has agent
        </button>
        {filterApi.availablePriorities.map((p) => {
          const on = filterApi.filters.priorities.has(p);
          return (
            <button
              key={p}
              type="button"
              className={`kb-pill${on ? ' on' : ''}`}
              onClick={() => filterApi.togglePriority(p)}
              aria-pressed={on}
            >
              {on ? <span className="kb-pill-x" /> : null}
              priority:{p}
            </button>
          );
        })}
        {filterApi.availableAreas.slice(0, 4).map((area) => {
          const on = filterApi.filters.areas.has(area);
          return (
            <button
              key={area}
              type="button"
              className={`kb-pill${on ? ' on' : ''}`}
              onClick={() => filterApi.toggleArea(area)}
              aria-pressed={on}
            >
              {on ? <span className="kb-pill-x" /> : null}
              {area}
            </button>
          );
        })}
        {filterApi.filters.hasAgent ||
        filterApi.filters.priorities.size > 0 ||
        filterApi.filters.areas.size > 0 ? (
          <button
            type="button"
            className="kb-pill"
            onClick={filterApi.clear}
            title="Clear filters"
            style={{ color: 'var(--ink-3)' }}
          >
            clear
          </button>
        ) : null}
        <span className="kb-stats-line">
          {stats.issues} issue{stats.issues === 1 ? '' : 's'} · {stats.runs} active run
          {stats.runs === 1 ? '' : 's'} · {stats.awaiting} awaiting
          {stats.costToday > 0 ? ` · $${stats.costToday.toFixed(2)} today` : ''}
        </span>
      </div>
      <div className="kb-usage-row">
        <UsageMeter label="5h" usage={costUsage?.fiveHour ?? null} />
        <UsageMeter label="7d" usage={costUsage?.sevenDay ?? null} />
      </div>
      {moveError ? (
        <div
          role="alert"
          style={{
            padding: '8px 18px',
            color: 'var(--failed)',
            fontSize: 12,
            background: 'oklch(0.7 0.18 25 / 0.08)',
            borderBottom: '1px solid var(--hairline-soft)',
          }}
        >
          {moveError}
          <button
            type="button"
            onClick={() => setMoveError(null)}
            aria-label="dismiss"
            style={{
              marginLeft: 8,
              background: 'transparent',
              border: 'none',
              color: 'var(--failed)',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="kb-board">
        {COLUMNS.map((col) => (
          <Column
            key={String(col.key)}
            columnKey={col.key}
            status={col.status}
            label={col.label}
            issues={col.key === null ? grouped.untagged : grouped.byKey[col.key]}
            selectedNumber={selectedNumber}
            liveByRun={liveByRun}
            onSelect={setSelectedNumber}
            onOpen={(n) => {
              setSelectedNumber(n);
              onOpenDetail?.(n);
            }}
            {...(col.key === 'backlog'
              ? { onSuggest: openPersonaPicker, suggesting }
              : {})}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <CardPreview issue={activeIssue} /> : null}
      </DragOverlay>
      {personaPickerOpen ? (
        <PersonaPickerModal
          onClose={() => setPersonaPickerOpen(false)}
          onPick={(persona) => void runSuggestionWith(persona)}
        />
      ) : null}
      {autopilotLaunchOpen ? (
        <AutopilotLaunchModal
          onClose={() => setAutopilotLaunchOpen(false)}
          onStarted={() => dispatchIssuesRefetch()}
        />
      ) : null}
      {archiveOpen ? (
        <ArchiveModal
          onClose={() => setArchiveOpen(false)}
          onOpenDetail={(n) => onOpenDetail?.(n)}
        />
      ) : null}
      {sentrySettingsOpen ? (
        <SentrySettingsModal onClose={() => setSentrySettingsOpen(false)} />
      ) : null}
    </DndContext>
  );
}

interface UsageWindow {
  pct: number;
  resetsAt: string | null;
}

function UsageMeter({ label, usage }: { label: string; usage: UsageWindow | null }) {
  if (usage === null) {
    return (
      <div className="kb-usage-meter is-empty" title={`${label} usage unavailable`}>
        <span className="kb-usage-label">{label}</span>
        <span className="kb-usage-bar" aria-hidden>
          <span className="kb-usage-bar-fill" style={{ width: '0%' }} />
        </span>
        <span className="kb-usage-pct">—</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(1, usage.pct));
  const tone = pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warn' : 'ok';
  const display = `${Math.round(pct * 100)}%`;
  const reset = usage.resetsAt ? formatResetCountdown(usage.resetsAt) : null;
  const title = usage.resetsAt
    ? `${label} window · ${display} used · resets ${new Date(usage.resetsAt).toLocaleString()}`
    : `${label} window · ${display} used`;
  return (
    <div className={`kb-usage-meter tone-${tone}`} title={title}>
      <span className="kb-usage-label">{label}</span>
      <span className="kb-usage-bar" aria-hidden>
        <span className="kb-usage-bar-fill" style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="kb-usage-pct">{display}</span>
      {reset ? <span className="kb-usage-reset">Resets in {reset}</span> : null}
    </div>
  );
}

// Countdown until the reset boundary, in the user's local frame of
// reference. Examples: "1 hr 55 min", "23 min", "2 d 3 hr", "<1 min".
function formatResetCountdown(iso: string): string {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return '';
  const ms = target - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const totalHr = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalHr < 24) return remMin === 0 ? `${totalHr} hr` : `${totalHr} hr ${remMin} min`;
  const days = Math.floor(totalHr / 24);
  const remHr = totalHr % 24;
  return remHr === 0 ? `${days} d` : `${days} d ${remHr} hr`;
}
