import { useIssues } from '../../hooks/useIssues.js';
import { useWorkspace, type WorkspaceFolder } from '../../hooks/useWorkspace.js';
import { colorForLogin } from '../../labels.js';
import type { Issue } from '../../types.js';

export interface LeftRailProps {
  selectedNumber: number | null;
  onSelectIssue: (n: number) => void;
  onOpenPalette?: () => void;
  authorLogin?: string | null;
}

function FolderCard({
  folder,
  activeAgents,
}: {
  folder: WorkspaceFolder;
  activeAgents: number;
}) {
  const glyph = folder.name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'KB';
  return (
    <div className="kb-workspace" role="region" aria-label="Workspace folder">
      <div className="kb-workspace-glyph" aria-hidden>
        {glyph}
      </div>
      <div className="kb-workspace-meta">
        <div className="kb-workspace-name">{folder.name}</div>
        <div className="kb-workspace-path">{folder.branch}</div>
      </div>
      {activeAgents > 0 ? (
        <div className="kb-workspace-pulse" aria-label={`${activeAgents} active agents`}>
          <span className="kb-pulse" />
          {activeAgents}
        </div>
      ) : null}
    </div>
  );
}

function LiveAgentRow({
  issue,
  selected,
  onClick,
}: {
  issue: Issue;
  selected: boolean;
  onClick: () => void;
}) {
  const stateCls =
    issue.agent === 'blocked'
      ? 'kb-state-awaiting'
      : issue.agent === 'review'
        ? 'kb-state-review'
        : '';
  const tool = issue.activeRun?.currentTool ?? null;
  const arg = issue.activeRun?.currentArg ?? null;
  const argTail = arg ? arg.split('/').pop() ?? arg : '';
  return (
    <button
      type="button"
      className="kb-swarm-card"
      onClick={onClick}
      aria-pressed={selected}
      title={issue.title}
    >
      <span className={`kb-swarm-bar ${stateCls}`} aria-hidden />
      <span className="kb-swarm-meta">
        <div className="kb-swarm-num">
          #{issue.number}
          {issue.activeRun ? ` · run ${issue.activeRun.id}` : ''}
        </div>
        <div className="kb-swarm-title">{issue.title}</div>
        <div className="kb-swarm-tool">
          {issue.agent === 'blocked'
            ? 'awaiting input'
            : tool
              ? `${tool}${argTail ? ` · ${argTail.slice(0, 28)}` : ''}`
              : 'starting…'}
        </div>
      </span>
    </button>
  );
}

export function LeftRail({
  selectedNumber,
  onSelectIssue,
  onOpenPalette,
  authorLogin,
}: LeftRailProps) {
  const ws = useWorkspace();
  const { issues } = useIssues();

  const liveAgents = issues.filter(
    (i) =>
      i.agent === 'running' || i.agent === 'blocked' || i.agent === 'review',
  );
  const runs = liveAgents.filter((i) => i.agent === 'running').length;

  const me: string = authorLogin ?? 'you';
  const meColor = colorForLogin(me);

  const currentFolder =
    ws.folders.find((f) => f.current) ?? ws.folders[0] ?? null;

  return (
    <div className="kb-rail">
      <div className="kb-rail-section">
        <div className="kb-rail-label">Workspace</div>
        {currentFolder ? (
          <FolderCard folder={currentFolder} activeAgents={ws.workspace.activeAgents} />
        ) : null}
      </div>

      {liveAgents.length > 0 ? (
        <div className="kb-rail-section">
          <div className="kb-rail-label">Live agents</div>
          {liveAgents.map((issue) => (
            <LiveAgentRow
              key={issue.number}
              issue={issue}
              selected={selectedNumber === issue.number}
              onClick={() => onSelectIssue(issue.number)}
            />
          ))}
        </div>
      ) : null}

      <div className="kb-rail-foot">
        <div className="kb-rail-avatar" style={{ background: meColor }} aria-hidden>
          {String(me).slice(0, 1).toUpperCase()}
        </div>
        <div className="kb-who">
          <div className="kb-who-name">{String(me)}</div>
          <div className="kb-who-status">
            <span className="kb-pulse" />
            {runs} run{runs === 1 ? '' : 's'} · {issues.length} issue{issues.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          className="kb-rail-cmdk"
          onClick={onOpenPalette}
          title="Command palette (Phase 8)"
        >
          ⌘K
        </button>
      </div>
    </div>
  );
}
