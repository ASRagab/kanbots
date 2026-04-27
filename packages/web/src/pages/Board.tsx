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
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { CardPreview } from '../components/Card.js';
import { Column } from '../components/Column.js';
import { useBoardAgentStreams } from '../hooks/useBoardAgentStreams.js';
import { useBoardFilters } from '../hooks/useBoardFilters.js';
import { useFetch } from '../hooks/useFetch.js';
import { useIssues, dispatchIssuesRefetch } from '../hooks/useIssues.js';
import { useSelection } from '../hooks/useSelection.js';
import { COLUMNS, withStatus } from '../labels.js';
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

const filterIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 5h18l-7 9v6l-4-2v-4z" />
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

export interface BoardProps {
  onOpenDetail?: (issueNumber: number) => void;
  onOpenCreate?: () => void;
  onOpenPalette?: () => void;
}

export function Board({ onOpenDetail, onOpenCreate, onOpenPalette }: BoardProps = {}) {
  const { data: config } = useFetch('config', () => api.config());
  const { issues, loading, error, mutate } = useIssues();
  const { data: costToday } = useFetch('cost:today', () => api.costToday());
  const filterApi = useBoardFilters(issues);

  const [activeNumber, setActiveNumber] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
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
          <button type="button" className="kb-btn ghost">
            {filterIcon} Filter
          </button>
          <button type="button" className="kb-btn ghost">
            Group: status
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
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <CardPreview issue={activeIssue} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
