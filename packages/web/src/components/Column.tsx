import { useDroppable } from '@dnd-kit/core';
import type { Issue, StatusKey } from '../types.js';
import { Card } from './Card.js';
import type { RunLiveMap } from '../hooks/useBoardAgentStreams.js';

export function columnDropId(key: StatusKey | null): string {
  return `col:${key ?? 'inbox'}`;
}

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

const sparkleIcon = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);

export interface ColumnProps {
  columnKey: StatusKey | null;
  status: 'inbox' | StatusKey;
  label: string;
  issues: Issue[];
  selectedNumber?: number | null;
  liveByRun?: RunLiveMap;
  onSelect?: (n: number) => void;
  onOpen?: (n: number) => void;
  onAdd?: (status: StatusKey | null) => void;
  onSuggest?: () => void;
  suggesting?: boolean;
}

export function Column({
  columnKey,
  status,
  label,
  issues,
  selectedNumber = null,
  liveByRun,
  onSelect,
  onOpen,
  onAdd,
  onSuggest,
  suggesting = false,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(columnKey) });
  return (
    <div ref={setNodeRef} className="kb-col" data-over={isOver ? 'true' : undefined}>
      <div className="kb-col-head" data-status={status}>
        <span className="kb-col-glyph" aria-hidden />
        <span className="kb-col-name">{label}</span>
        <span className="kb-col-count">{issues.length}</span>
        {onAdd ? (
          <button
            type="button"
            className="kb-col-add"
            title="Add issue"
            aria-label={`Add issue to ${label}`}
            onClick={() => onAdd(columnKey)}
          >
            {plusIcon}
          </button>
        ) : null}
        {onSuggest ? (
          <button
            type="button"
            className="kb-col-suggest"
            title={suggesting ? 'Claude is thinking…' : 'Ask Claude to suggest a feature'}
            aria-label={`Suggest a feature for ${label}`}
            aria-busy={suggesting || undefined}
            disabled={suggesting}
            onClick={onSuggest}
          >
            {sparkleIcon}
            <span>{suggesting ? 'Suggesting…' : 'Suggest'}</span>
          </button>
        ) : null}
      </div>
      <div className="kb-col-list">
        {suggesting ? <SuggestingSkeletonCard /> : null}
        {issues.length === 0 && !suggesting ? (
          <div className="kb-col-empty">—</div>
        ) : (
          issues.map((issue) => {
            const live =
              issue.activeRun && liveByRun?.get(issue.activeRun.id)?.currentTool
                ? {
                    name: liveByRun.get(issue.activeRun.id)!.currentTool!,
                    arg: liveByRun.get(issue.activeRun.id)?.currentArg ?? null,
                  }
                : null;
            return (
              <Card
                key={issue.number}
                issue={issue}
                selected={selectedNumber === issue.number}
                liveTool={live}
                onSelect={onSelect ?? (() => undefined)}
                onOpen={onOpen ?? (() => undefined)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function SuggestingSkeletonCard() {
  return (
    <div className="kb-card kb-card-skeleton" aria-busy="true" aria-label="Claude is suggesting a feature">
      <div className="kb-card-row1">
        <span className="kb-skel kb-skel-num" />
        <span className="kb-skel kb-skel-tag" />
      </div>
      <div className="kb-skel kb-skel-line kb-skel-title" />
      <div className="kb-skel kb-skel-line kb-skel-line-short" />
      <div className="kb-card-meta">
        <span className="kb-skel kb-skel-pill" />
        <span className="kb-skel kb-skel-pill kb-skel-pill-sm" />
      </div>
    </div>
  );
}
