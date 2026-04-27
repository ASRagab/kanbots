import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { api } from '../../api.js';
import { useFetch } from '../../hooks/useFetch.js';
import {
  useIssues,
  dispatchIssuesRefetch,
  ISSUES_CHANGED_CHANNEL,
} from '../../hooks/useIssues.js';
import { useAgentRunStream } from '../../hooks/useAgentRunStream.js';
import {
  ageString,
  areaLabels,
  colorForLogin,
  linkedIssueNumbers,
  priorityFromLabels,
  tagFromLabels,
} from '../../labels.js';
import { PreviewPanel } from '../run/PreviewPanel.js';
import { RunSummary } from '../run/RunSummary.js';
import type {
  AgentEvent,
  AgentRun,
  AgentRunStatus,
  AutopilotChildEntry,
  AutopilotSession,
  Card,
  DecisionPayload,
  DiffFile,
  DiffPayload,
  IssueDetail as IssueDetailPayload,
  Message,
} from '../../types.js';

const TAB_LABELS: Record<DetailTab, string> = {
  autopilot: 'Autopilot',
  overview: 'Overview',
  thread: 'Thread',
  diff: 'Diff',
  preview: 'Preview',
  runs: 'Runs',
};
type DetailTab = 'autopilot' | 'overview' | 'thread' | 'diff' | 'preview' | 'runs';

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  starting: 'STARTING',
  running: 'RUNNING',
  awaiting_input: 'AWAITING INPUT',
  complete: 'COMPLETE',
  failed: 'FAILED',
  stopped: 'STOPPED',
};

function fmtElapsed(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return '—';
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export interface TaskDetailModalProps {
  issueNumber: number;
  onClose: () => void;
}

export function TaskDetailModal({ issueNumber, onClose }: TaskDetailModalProps) {
  const { data, loading, error, refetch } = useFetch<IssueDetailPayload>(
    `issue:${issueNumber}`,
    () => api.issue(issueNumber),
  );
  const isAutopilot = (data?.issue?.labels ?? []).includes('type:autopilot');
  const [tab, setTab] = useState<DetailTab>(isAutopilot ? 'autopilot' : 'overview');
  useEffect(() => {
    if (isAutopilot && tab !== 'autopilot' && tab !== 'thread') {
      // Default an autopilot card to its dedicated tab on load.
      setTab('autopilot');
    }
    // Only run on mount and when isAutopilot flips true; honour user's later picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutopilot]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Refetch this issue's detail whenever the main process signals a change.
  // Debounced so a burst of run-status flips collapses to one fetch.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.kanbots : undefined;
    if (!bridge) return;
    const unsubscribe = bridge.subscribe(ISSUES_CHANGED_CHANNEL, () => {
      if (debounceRef.current !== null) return;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void refetch();
      }, 80);
    });
    return () => {
      unsubscribe();
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [refetch]);

  function stopInner(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  const issue = data?.issue ?? null;
  const activeRun = data?.thread?.activeRun ?? null;
  const latestRun = data?.thread?.latestRun ?? null;
  const displayRun = activeRun ?? latestRun;
  const messages = data?.thread?.messages ?? [];
  const isRunning =
    activeRun?.status === 'running' ||
    activeRun?.status === 'awaiting_input' ||
    activeRun?.status === 'starting';

  const visibleTabs: DetailTab[] = isAutopilot
    ? ['autopilot', 'overview']
    : ['overview', 'thread', 'diff', 'preview', 'runs'];

  return (
    <div className="kb-modal-scrim kb-app" onClick={onClose} role="dialog" aria-modal="true">
      <div className="kb-modal" onClick={stopInner}>
        <div className="kb-modal-head">
          <span className="crumb-chip">
            <b>kanbots</b>
          </span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span className="num">#{issueNumber}</span>
          <h2>{issue?.title ?? (loading ? 'Loading…' : 'Issue')}</h2>
          <span className="grow" />
          {isAutopilot ? (
            <AutopilotStopButton issueNumber={issueNumber} onAfter={() => void refetch()} />
          ) : null}
          {!isAutopilot && activeRun && isRunning ? (
            <button
              type="button"
              className="kb-btn ghost"
              onClick={() => void api.stopAgent(activeRun.id).then(() => refetch())}
            >
              Stop
            </button>
          ) : null}
          {!isAutopilot ? (
            <button type="button" className="kb-btn ghost" disabled title="Phase 11">
              Fork run
            </button>
          ) : null}
          {!isAutopilot && displayRun ? (
            <button type="button" className="kb-btn primary" onClick={() => setTab('preview')}>
              Open preview ↗
            </button>
          ) : null}
          {!isAutopilot ? (
            <button
              type="button"
              className="kb-btn ghost"
              onClick={() => {
                const msg = isRunning
                  ? 'Archive this ticket? Its running agent will be stopped.'
                  : 'Archive this ticket?';
                if (!window.confirm(msg)) return;
                void api.archiveIssue(issueNumber).then(() => {
                  dispatchIssuesRefetch();
                  onClose();
                });
              }}
            >
              Archive
            </button>
          ) : null}
          <button
            type="button"
            className="x-btn"
            onClick={onClose}
            aria-label="Close (Esc)"
            title="Close"
          >
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

        <div className="kb-modal-body">
          <main className="kb-modal-main">
            {issue ? (
              <>
                <div className={`kb-tdm-hero${isRunning ? ' running' : ''}`}>
                  <div className="kb-tdm-title-row">
                    <span className="kb-tdm-num">#{issue.number}</span>
                    <h1 className="kb-tdm-h1">{issue.title}</h1>
                  </div>
                  <div className="kb-tdm-meta-row">
                    {activeRun ? (
                      <span
                        className={`kb-status-pill kb-state-${
                          activeRun.status === 'awaiting_input'
                            ? 'awaiting'
                            : activeRun.status === 'running'
                              ? 'running'
                              : activeRun.status === 'failed'
                                ? 'failed'
                                : ''
                        }`}
                      >
                        <span className="kb-pulse" />
                        {STATUS_LABEL[activeRun.status]} · run #{activeRun.id}
                      </span>
                    ) : null}
                    {tagFromLabels(issue.labels, issue.isPullRequest) ? (
                      <span
                        className={`kb-tag kb-tag-${tagFromLabels(issue.labels, issue.isPullRequest)}`}
                      >
                        {tagFromLabels(issue.labels, issue.isPullRequest)}
                      </span>
                    ) : null}
                    {areaLabels(issue.labels).map((l) => (
                      <span key={l} className="kb-chip mono">
                        {l}
                      </span>
                    ))}
                    {priorityFromLabels(issue.labels) ? (
                      <span className="kb-chip mono">
                        priority:{priorityFromLabels(issue.labels)}
                      </span>
                    ) : null}
                    {displayRun?.branchName ? (
                      <span className="kb-chip mono">
                        <span className="k">branch</span>
                        {displayRun.branchName}
                      </span>
                    ) : null}
                    <span className="kb-chip mono">
                      <span className="k">opened</span>
                      {ageString(issue.createdAt)} ago
                    </span>
                  </div>
                </div>

                <div className="kb-tdm-tabs">
                  {visibleTabs.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`kb-tdm-tab${tab === t ? ' active' : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {TAB_LABELS[t]}
                    </button>
                  ))}
                </div>

                <div className="kb-tdm-content">
                  {tab === 'autopilot' ? (
                    <AutopilotTab issueNumber={issue.number} />
                  ) : null}
                  {tab === 'overview' ? (
                    <OverviewTab issue={issue} displayRun={displayRun} />
                  ) : null}
                  {tab === 'thread' && !isAutopilot ? (
                    <ThreadTab
                      activeRun={activeRun}
                      displayRun={displayRun}
                      messages={messages}
                      issueNumber={issueNumber}
                      onActionDone={() => void refetch()}
                    />
                  ) : null}
                  {tab === 'diff' && !isAutopilot ? <DiffTabModal activeRun={displayRun} /> : null}
                  {tab === 'preview' && !isAutopilot ? <PreviewTabModal activeRun={displayRun} /> : null}
                  {tab === 'runs' && !isAutopilot ? <RunsTab issueNumber={issue.number} /> : null}
                </div>
              </>
            ) : error ? (
              <div className="kb-tdm-content" style={{ color: 'var(--failed)' }}>
                {error.message}
              </div>
            ) : (
              <div className="kb-tdm-content">Loading…</div>
            )}
          </main>

          <aside className="kb-modal-aside">
            {issue ? (
              <Aside
                issue={issue}
                activeRun={activeRun}
                latestRun={latestRun}
              />
            ) : null}
          </aside>
        </div>

        <div className="kb-modal-foot">
          <span className="hint">Reply to agent</span>
          <ReplyFooter issueNumber={issueNumber} onSent={() => void refetch()} />
        </div>
      </div>
    </div>
  );
}

function ReplyFooter({
  issueNumber,
  onSent,
}: {
  issueNumber: number;
  onSent: () => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.postMessage(issueNumber, trimmed);
      setBody('');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      <input
        type="text"
        placeholder="/spec to refine · /review to spawn reviewer · /split to fan out…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
        disabled={sending}
      />
      <button
        type="button"
        className="kb-btn primary"
        onClick={() => void send()}
        disabled={!body.trim() || sending}
      >
        {sending ? 'Sending…' : 'Send'} <span className="kb-kbd">⌘↵</span>
      </button>
      {error ? (
        <span style={{ color: 'var(--failed)', fontSize: 11, marginLeft: 8 }}>{error}</span>
      ) : null}
    </>
  );
}

function Aside({
  issue,
  activeRun,
  latestRun,
}: {
  issue: IssueDetailPayload['issue'];
  activeRun: AgentRun | null;
  latestRun: AgentRun | null;
}) {
  const links = linkedIssueNumbers(issue.labels);
  const sidebarRun = activeRun ?? latestRun;
  const sidebarHeader = activeRun ? 'Live run' : latestRun ? 'Last run' : 'Run';
  return (
    <>
      <div className="kb-mas-block">
        <div className="kb-mas-h">{sidebarHeader}</div>
        {sidebarRun ? (
          <RunSummary run={sidebarRun} layout="aside" />
        ) : (
          <div className="kb-desc-md" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
            No agent runs yet.
          </div>
        )}
      </div>

      <div className="kb-mas-block">
        <div className="kb-mas-h">Properties</div>
        <div className="kb-mas-row">
          <span className="k">Status</span>
          <span className="v">{issue.status ?? 'inbox'}</span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Assignee</span>
          <span className="v">{issue.assignees[0] ?? '—'}</span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Priority</span>
          <span className="v">{priorityFromLabels(issue.labels) ?? '—'}</span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Folder</span>
          <span className="v mono">current</span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Worktree</span>
          <span className="v mono">
            {sidebarRun?.worktreePath ?? '—'}
          </span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Branch</span>
          <span className="v mono">{sidebarRun?.branchName ?? '—'}</span>
        </div>
        <div className="kb-mas-row">
          <span className="k">Base</span>
          <span className="v mono">main</span>
        </div>
      </div>

      {links.length > 0 ? (
        <div className="kb-mas-block">
          <div className="kb-mas-h">Linked</div>
          <LinkedIssues numbers={links} currentNumber={issue.number} />
        </div>
      ) : null}

      <div className="kb-mas-block">
        <div className="kb-mas-h">Author</div>
        <div className="kb-mas-row">
          <span
            className="kb-rail-avatar"
            style={{
              width: 22,
              height: 22,
              fontSize: 10,
              background: colorForLogin(issue.user.login),
            }}
            aria-hidden
          >
            {issue.user.login.slice(0, 1).toUpperCase()}
          </span>
          <span className="v">{issue.user.login}</span>
        </div>
      </div>
    </>
  );
}

function LinkedIssues({
  numbers,
  currentNumber,
}: {
  numbers: number[];
  currentNumber: number;
}) {
  const { issues } = useIssues();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {numbers
        .filter((n) => n !== currentNumber)
        .map((n) => {
          const linked = issues.find((i) => i.number === n);
          return (
            <a
              key={n}
              href={`#/issue/${n}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'var(--bg-2)',
                border: '1px solid var(--hairline-soft)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--ff-mono)',
                  fontSize: 11,
                  color: 'var(--ink-3)',
                }}
              >
                #{n}
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'var(--ink-1)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {linked?.title ?? '(not loaded)'}
              </span>
              {linked?.state === 'closed' ? (
                <span style={{ color: 'var(--review)', fontSize: 10 }}>closed</span>
              ) : null}
            </a>
          );
        })}
    </div>
  );
}

function OverviewTab({
  issue,
  displayRun,
}: {
  issue: IssueDetailPayload['issue'];
  displayRun: AgentRun | null;
}) {
  const stream = useAgentRunStream(displayRun?.id ?? null);
  const recentToolCalls = stream.events.filter((e) => e.type === 'tool_use').slice(-4).reverse();
  const acMatches = (issue.body ?? '').match(/(?:^|\n)\s*AC:\s*\n((?:[-*]\s.+\n?)+)/);
  const acItems = acMatches?.[1]?.match(/(?:^|\n)[-*]\s(.+)/g)?.map((l) => l.replace(/^[\s-*]+/, '')) ?? [];

  return (
    <>
      <div className="kb-tdm-section">
        <h3>Description</h3>
        <div className="kb-desc-md">{issue.body || '(no description)'}</div>
      </div>

      {acItems.length > 0 ? (
        <div className="kb-tdm-section">
          <h3>Spec — extracted from AC: block</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {acItems.map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 12.5, color: 'var(--ink-1)' }}>
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    border: '1px solid var(--hairline)',
                    background: 'var(--bg-2)',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                  aria-hidden
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recentToolCalls.length > 0 ? (
        <div className="kb-tdm-section">
          <h3>What the agent did just now</h3>
          {recentToolCalls.map((ev) => {
            const p = ev.payload as { name?: string; input?: unknown };
            return (
              <div key={ev.id} className="kb-tcall">
                <div className="kb-tcall-head">
                  <span className="name">{p.name ?? 'tool'}</span>
                  <span className="arg">
                    {typeof p.input === 'string' ? p.input : JSON.stringify(p.input)}
                  </span>
                  <span className="dur">{ageString(ev.createdAt)} ago</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

type TimelineItem =
  | { kind: 'event'; sortKey: string; id: string; event: AgentEvent }
  | { kind: 'message'; sortKey: string; id: string; message: Message; cards: Card[] };

function ThreadTab({
  activeRun,
  displayRun,
  messages,
  issueNumber,
  onActionDone,
}: {
  activeRun: AgentRun | null;
  displayRun: AgentRun | null;
  messages: Message[];
  issueNumber: number;
  onActionDone: () => void;
}) {
  const stream = useAgentRunStream(displayRun?.id ?? null);
  const isLive = activeRun !== null && activeRun.id === displayRun?.id;

  const cardsByMessageId = new Map<number, Card[]>();
  for (const c of stream.cards) {
    const arr = cardsByMessageId.get(c.messageId) ?? [];
    arr.push(c);
    cardsByMessageId.set(c.messageId, arr);
  }

  const items: TimelineItem[] = [];
  for (const m of messages) {
    items.push({
      kind: 'message',
      sortKey: m.createdAt,
      id: `m${m.id}`,
      message: m,
      cards: cardsByMessageId.get(m.id) ?? [],
    });
  }
  let latestTool: AgentEvent | null = null;
  for (const e of stream.events) {
    if (e.type === 'tool_use') {
      if (latestTool === null || e.seq > latestTool.seq) latestTool = e;
      continue;
    }
    items.push({ kind: 'event', sortKey: e.createdAt, id: `e${e.id}`, event: e });
  }
  items.sort((a, b) => {
    if (a.sortKey === b.sortKey) return a.id.localeCompare(b.id);
    return a.sortKey < b.sortKey ? -1 : 1;
  });

  const lastLoggedKey = items.length > 0 ? items[items.length - 1]!.sortKey : '';
  const showLatestTool = latestTool !== null && latestTool.createdAt > lastLoggedKey;

  if (items.length === 0 && !showLatestTool) {
    return (
      <div className="kb-tdm-section">
        <h3>Agent thread</h3>
        <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
          No agent activity yet. Reply below to start the conversation.
        </div>
      </div>
    );
  }

  return (
    <div className="kb-tdm-section">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Agent thread</h3>
        {displayRun ? (
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            run #{displayRun.id} · {STATUS_LABEL[displayRun.status]}
            {isLive ? '' : ` · ended ${ageString(displayRun.endedAt ?? displayRun.startedAt)} ago`}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) =>
          it.kind === 'message' ? (
            <MessageRow key={it.id} message={it.message} cards={it.cards} />
          ) : (
            <EventRow key={it.id} event={it.event} isLive={isLive} />
          ),
        )}
        {showLatestTool && latestTool ? (
          <EventRow key="latest-tool" event={latestTool} isLive={isLive} />
        ) : null}
        {displayRun && displayRun.status === 'complete' ? (
          <CompletionActions
            runId={displayRun.id}
            issueNumber={issueNumber}
            onChanged={onActionDone}
          />
        ) : null}
      </div>
    </div>
  );
}

function CompletionActions({
  runId,
  issueNumber,
  onChanged,
}: {
  runId: number;
  issueNumber: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function call<T>(
    name: string,
    fn: () => Promise<T>,
    success: (r: T) => string,
  ): Promise<void> {
    setBusy(name);
    setError(null);
    setInfo(null);
    try {
      const r = await fn();
      setInfo(success(r));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--accent-line)',
        borderRadius: 8,
        padding: 12,
        background: 'color-mix(in oklch, var(--bg-1) 80%, var(--accent-soft))',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>
        <b style={{ color: 'var(--accent)' }}>Run complete.</b> What's next?
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="kb-btn ghost"
          disabled={busy !== null}
          onClick={() =>
            void call(
              'review',
              () => api.spawnReviewer(issueNumber),
              (r) => `Review agent started — run #${r.id}`,
            )
          }
        >
          {busy === 'review' ? 'Spawning…' : 'Review code'}
        </button>
        <button
          type="button"
          className="kb-btn ghost"
          disabled={busy !== null}
          onClick={() => {
            if (!window.confirm('Squash-merge this run into the base branch?')) return;
            void call(
              'commit',
              () => api.promoteCommit(runId),
              (r) => {
                const parts = [`Committed ${r.commitSha.slice(0, 7)} on ${r.base}`];
                if (r.cleanup.worktreeRemoved) parts.push('worktree removed');
                if (r.cleanup.branchDeleted) parts.push('branch deleted');
                return parts.join(' · ');
              },
            );
          }}
        >
          {busy === 'commit' ? 'Committing…' : 'Commit to base branch'}
        </button>
        <button
          type="button"
          className="kb-btn ghost"
          disabled={busy !== null}
          onClick={() =>
            void call(
              'pr',
              () => api.promotePR(runId),
              (r) => `PR opened: ${r.pr.htmlUrl}`,
            )
          }
        >
          {busy === 'pr' ? 'Opening…' : 'Open PR'}
        </button>
      </div>
      {info ? (
        <div style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 8 }}>{info}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 11, color: 'var(--failed)', marginTop: 8 }}>error: {error}</div>
      ) : null}
    </div>
  );
}

function MessageRow({ message, cards }: { message: Message; cards: Card[] }) {
  if (message.role === 'system') {
    return (
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          textAlign: 'center',
          padding: '4px 0',
        }}
      >
        — {message.body} · {ageString(message.createdAt)} ago —
        {cards.map((c) =>
          c.type === 'decision' ? (
            <DecisionInline key={c.id} card={c as Card<DecisionPayload>} />
          ) : null,
        )}
      </div>
    );
  }
  const isUser = message.role === 'user';
  const label = isUser ? 'you' : 'claude';
  const labelColor = isUser ? 'var(--ink-1)' : 'var(--accent)';
  const bg = isUser
    ? 'var(--bg-2)'
    : 'color-mix(in oklch, var(--bg-1) 80%, var(--accent-soft))';
  const border = isUser ? 'var(--hairline)' : 'var(--accent-line)';
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 5 }}>
        <b style={{ color: labelColor }}>{label}</b> · {ageString(message.createdAt)} ago
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>
        {message.body}
      </div>
      {cards.map((c) =>
        c.type === 'decision' ? (
          <DecisionInline key={c.id} card={c as Card<DecisionPayload>} />
        ) : null,
      )}
    </div>
  );
}

function DecisionInline({ card }: { card: Card<DecisionPayload> }) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPending = card.status === 'pending';
  const isResolved = card.status === 'resolved';
  const isDismissed = card.status === 'dismissed';

  async function pick(value: string): Promise<void> {
    if (!isPending || submitting !== null) return;
    setSubmitting(value);
    setError(null);
    try {
      await api.resolveCard(card.id, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  }

  async function dismiss(): Promise<void> {
    if (!isPending || submitting !== null) return;
    setSubmitting('__dismiss');
    setError(null);
    try {
      await api.dismissCard(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(null);
    }
  }

  return (
    <div className="kb-decision" role="region" aria-label="Agent question" style={{ marginTop: 10 }}>
      <div className="kb-decision-opts">
        {card.payload.options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            className={`kb-decision-opt${submitting === opt.value ? ' chosen' : ''}`}
            disabled={!isPending || submitting !== null}
            onClick={() => void pick(opt.value)}
          >
            <span className="num">{i + 1}</span>
            {opt.label}
          </button>
        ))}
        {isPending ? (
          <button
            key="__dismiss"
            type="button"
            className="kb-decision-opt dismiss"
            disabled={submitting !== null}
            onClick={() => void dismiss()}
            title="Dismiss this decision and stop the run"
          >
            Dismiss
          </button>
        ) : null}
      </div>
      {isResolved ? <div className="kb-decision-resolved-note">resolved</div> : null}
      {isDismissed ? <div className="kb-decision-resolved-note">dismissed</div> : null}
      {error ? <div className="kb-decision-resolved-note">error: {error}</div> : null}
    </div>
  );
}

function EventRow({ event, isLive }: { event: AgentEvent; isLive: boolean }) {
  if (event.type === 'text') {
    const text = (event.payload as { text?: string }).text ?? '';
    return (
      <div
        style={{
          background: 'color-mix(in oklch, var(--bg-1) 80%, var(--accent-soft))',
          border: '1px solid var(--accent-line)',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 5 }}>
          <b style={{ color: 'var(--accent)' }}>claude</b> · {ageString(event.createdAt)} ago
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>
          {text}
        </div>
      </div>
    );
  }
  if (event.type === 'tool_use') {
    const p = event.payload as { name?: string; input?: unknown };
    return (
      <div className="kb-tcall">
        <div className="kb-tcall-head">
          <span className="name">{p.name ?? 'tool'}</span>
          <span className="arg">
            {typeof p.input === 'string' ? p.input : JSON.stringify(p.input)}
          </span>
          <span className="dur" style={{ color: isLive ? 'var(--running)' : 'var(--ink-3)' }}>
            {isLive ? '● live' : ageString(event.createdAt) + ' ago'}
          </span>
        </div>
      </div>
    );
  }
  if (event.type === 'error') {
    const p = event.payload as { message?: string };
    return (
      <div className="kb-tcall" style={{ borderColor: 'var(--failed)' }}>
        <div className="kb-tcall-head">
          <span className="name" style={{ color: 'var(--failed)' }}>error</span>
          <span className="arg">{p.message ?? 'unknown'}</span>
          <span className="dur">{ageString(event.createdAt)} ago</span>
        </div>
      </div>
    );
  }
  return null;
}

function DiffTabModal({ activeRun }: { activeRun: AgentRun | null }) {
  const [data, setData] = useState<DiffPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRun) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getAgentRunDiff(activeRun.id)
      .then((p) => {
        if (!cancelled) setData(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun?.id]);

  if (!activeRun) {
    return (
      <div className="kb-tdm-section">
        <h3>Diff</h3>
        <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
          No active run for this issue.
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="kb-tdm-section">
        <h3>Diff</h3>
        <div className="kb-desc-md">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="kb-tdm-section">
        <h3>Diff</h3>
        <div className="kb-desc-md" style={{ color: 'var(--failed)' }}>
          {error}
        </div>
      </div>
    );
  }
  if (!data || data.empty) {
    return (
      <div className="kb-tdm-section">
        <h3>Diff</h3>
        <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
          No changes vs. base.
        </div>
      </div>
    );
  }
  return (
    <div className="kb-tdm-section">
      <h3>
        Diff vs {data.base} · {data.files.length} file{data.files.length === 1 ? '' : 's'}
      </h3>
      <div className="kb-diff-block">
        <div className="kb-diff-head">
          <span className="branch">{data.branch ?? 'HEAD'}</span>
          <span className="arrow">←</span>
          <span className="branch" style={{ color: 'var(--ink-3)' }}>
            {data.base}
          </span>
          <span className="stat">{data.files.length}</span>
        </div>
        {data.files.map((f) => (
          <DiffFileBlockModal key={f.path} file={f} />
        ))}
      </div>
    </div>
  );
}

function DiffFileBlockModal({ file }: { file: DiffFile }) {
  return (
    <div className="kb-diff-file">
      <div className="kb-diff-fhead">
        <span className={`stat-tag ${file.status}`}>{file.status}</span>
        <span className="path">{file.path}</span>
      </div>
      <div className="kb-diff-hunk">
        {file.patch.split('\n').map((line, idx) => {
          let cls = '';
          if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
            cls = '';
          } else if (line.startsWith('@@')) cls = 'hunk';
          else if (line.startsWith('+')) cls = 'add';
          else if (line.startsWith('-')) cls = 'del';
          return (
            <span key={idx} className={`kb-diff-line ${cls}`}>
              {line || ' '}
              {'\n'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PreviewTabModal({ activeRun }: { activeRun: AgentRun | null }) {
  return (
    <div className="kb-tdm-section">
      <h3>Branch preview · live dev server on this worktree</h3>
      <PreviewPanel
        branch={activeRun?.branchName ?? null}
        worktreePath={activeRun?.worktreePath ?? null}
        {...(activeRun ? { activeRunId: activeRun.id } : {})}
        size="tall"
      />
    </div>
  );
}

function RunsTab({ issueNumber }: { issueNumber: number }) {
  const { data, loading, error } = useFetch<AgentRun[]>(`runs:${issueNumber}`, () =>
    api.listIssueRuns(issueNumber),
  );

  if (loading) {
    return (
      <div className="kb-tdm-section">
        <h3>Run history</h3>
        <div className="kb-desc-md">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="kb-tdm-section">
        <h3>Run history</h3>
        <div className="kb-desc-md" style={{ color: 'var(--failed)' }}>
          {error.message}
        </div>
      </div>
    );
  }
  const runs = data ?? [];
  if (runs.length === 0) {
    return (
      <div className="kb-tdm-section">
        <h3>Run history</h3>
        <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
          No agent runs yet.
        </div>
      </div>
    );
  }

  return (
    <div className="kb-tdm-section">
      <h3>Run history</h3>
      <div className="kb-run-timeline">
        {runs.map((r) => {
          const status = r.status;
          const isActive =
            status === 'running' || status === 'awaiting_input' || status === 'starting';
          return (
            <div key={r.id} className={`kb-run-row kb-status-${status}`}>
              <div className="kb-marker">
                <div className="dot" />
              </div>
              <div>
                <div className="kb-run-meta-line">
                  <span style={{ color: isActive ? 'var(--running)' : 'var(--ink-2)', fontWeight: 600 }}>
                    {status === 'running' ? '● Running' : status === 'complete' ? '✓ Completed' : status === 'failed' ? '✗ Failed' : status === 'awaiting_input' ? '? Awaiting' : status === 'stopped' ? '◼ Stopped' : '… Starting'}
                  </span>
                  <span className="id">run #{r.id}</span>
                  <span>· {ageString(r.startedAt)} ago</span>
                </div>
                <div className="kb-run-summary">{r.exitReason ?? '(no exit reason)'}</div>
                <div className="kb-run-stats-inline">
                  <span>{r.model ?? '—'}</span>
                  <span>
                    {fmtTokens(r.tokenUsageInput)}/{fmtTokens(r.tokenUsageOutput)} tok
                  </span>
                  <span>{fmtElapsed(r.startedAt, r.endedAt ?? undefined)}</span>
                </div>
              </div>
              <button type="button" className="kb-btn ghost" disabled title="Phase 11">
                {isActive ? 'Stop' : 'View'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AutopilotStopButton({
  issueNumber,
  onAfter,
}: {
  issueNumber: number;
  onAfter: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop(stopChildren: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const session = await api.getAutopilotByIssue(issueNumber);
      if (!session) {
        throw new Error('Autopilot session not found for this card.');
      }
      await api.stopAutopilot(session.id, { stopChildren });
      setConfirmOpen(false);
      dispatchIssuesRefetch();
      onAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="kb-btn ghost"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
      >
        Stop autopilot
      </button>
      {confirmOpen ? (
        <div className="kb-modal-scrim kb-app" onClick={() => !busy && setConfirmOpen(false)}>
          <div
            className="kb-modal sm"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460 }}
          >
            <div className="kb-modal-head">
              <h2>Stop autopilot</h2>
              <span className="grow" />
            </div>
            <div className="kb-modal-body" style={{ display: 'block', padding: '14px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-1)', marginBottom: 12 }}>
                The autopilot loop will stop creating new tasks. Choose what happens to any
                child task that's currently running.
              </div>
              {error ? (
                <div style={{ fontSize: 11, color: 'var(--failed)', marginBottom: 8 }}>
                  {error}
                </div>
              ) : null}
            </div>
            <div className="kb-modal-foot">
              <button
                type="button"
                className="kb-btn ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <span className="grow" />
              <button
                type="button"
                className="kb-btn ghost"
                onClick={() => void stop(false)}
                disabled={busy}
              >
                Let children finish
              </button>
              <button
                type="button"
                className="kb-btn primary"
                onClick={() => void stop(true)}
                disabled={busy}
                style={{ marginLeft: 8 }}
              >
                {busy ? 'Stopping…' : 'Stop and cancel children'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AutopilotTab({ issueNumber }: { issueNumber: number }) {
  const { data, loading, error, refetch } = useFetch<AutopilotSession | null>(
    `autopilot:${issueNumber}`,
    () => api.getAutopilotByIssue(issueNumber),
  );

  // Refetch on broadcast — orchestrator fires `issues:changed` after every
  // session/cycle update.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.kanbots : undefined;
    if (!bridge) return;
    return bridge.subscribe(ISSUES_CHANGED_CHANNEL, () => {
      void refetch();
    });
  }, [refetch]);

  if (loading && !data) {
    return (
      <div className="kb-tdm-section">
        <h3>Autopilot</h3>
        <div className="kb-desc-md">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="kb-tdm-section">
        <h3>Autopilot</h3>
        <div className="kb-desc-md" style={{ color: 'var(--failed)' }}>
          {error.message}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="kb-tdm-section">
        <h3>Autopilot</h3>
        <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
          No autopilot session found for this card. It may have been started by an older app
          version.
        </div>
      </div>
    );
  }

  const session = data;
  const personas =
    session.config.kind === 'feature-dev' ? session.config.personas : [];
  const checks = session.config.kind === 'qa' ? session.config.checks : [];
  const liveUi = session.config.kind === 'qa' ? session.config.liveUi : false;
  const cycleHint =
    session.config.kind === 'feature-dev' && personas.length > 0
      ? `Next: ${personas[session.cycleIndex % personas.length]?.name ?? '—'}`
      : '';

  return (
    <div className="kb-tdm-section">
      <h3>Autopilot · {session.kind}</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 16px',
          fontSize: 12,
          marginBottom: 14,
        }}
      >
        <span style={{ color: 'var(--ink-3)' }}>Status</span>
        <span style={{ color: 'var(--ink-1)' }}>
          {session.status}
          {session.stopReason ? (
            <span style={{ color: 'var(--ink-3)' }}> · {session.stopReason}</span>
          ) : null}
        </span>
        <span style={{ color: 'var(--ink-3)' }}>Started</span>
        <span style={{ color: 'var(--ink-1)' }}>{ageString(session.startedAt)} ago</span>
        {session.endedAt ? (
          <>
            <span style={{ color: 'var(--ink-3)' }}>Ended</span>
            <span style={{ color: 'var(--ink-1)' }}>{ageString(session.endedAt)} ago</span>
          </>
        ) : null}
        <span style={{ color: 'var(--ink-3)' }}>Cycle</span>
        <span style={{ color: 'var(--ink-1)' }}>
          {session.cycleIndex} {cycleHint ? `· ${cycleHint}` : ''}
        </span>
      </div>

      {personas.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>Personas</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {personas.map((p, i) => (
              <span
                key={p.id}
                className="kb-chip mono"
                style={
                  i === session.cycleIndex % personas.length && session.status === 'running'
                    ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                    : undefined
                }
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {checks.length > 0 || liveUi ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6 }}>QA scope</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {checks.map((c) => (
              <span key={c.kind} className="kb-chip mono">
                {c.kind}: {c.command}
              </span>
            ))}
            {liveUi ? <span className="kb-chip mono">live UI</span> : null}
          </div>
        </div>
      ) : null}

      <div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
          Children · {session.children.length}
        </div>
        {session.children.length === 0 ? (
          <div className="kb-desc-md" style={{ color: 'var(--ink-3)' }}>
            No tasks created yet. The first one will appear shortly.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...session.children].reverse().map((child, idx) => (
              <ChildRow key={`${child.issueNumber}-${idx}`} child={child} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChildRow({ child }: { child: AutopilotChildEntry }) {
  const isReal = child.issueNumber > 0;
  return (
    <a
      href={isReal ? `#/issue/${child.issueNumber}` : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--bg-2)',
        border: '1px solid var(--hairline-soft)',
        textDecoration: 'none',
        color: 'inherit',
        fontSize: 12,
        cursor: isReal ? 'pointer' : 'default',
      }}
      onClick={(e) => {
        if (!isReal) e.preventDefault();
      }}
    >
      <span
        style={{
          fontFamily: 'var(--ff-mono)',
          fontSize: 11,
          color: 'var(--ink-3)',
          minWidth: 40,
        }}
      >
        {isReal ? `#${child.issueNumber}` : '—'}
      </span>
      <span
        className={`kb-tag kb-tag-${child.kind === 'bug' ? 'BUG' : 'FEAT'}`}
        style={{ flexShrink: 0 }}
      >
        {child.kind === 'bug' ? 'BUG' : 'FEAT'}
      </span>
      <span
        style={{
          flex: 1,
          color: 'var(--ink-1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {child.title}
      </span>
      {child.persona ? (
        <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{child.persona}</span>
      ) : null}
      <span
        style={{
          color:
            child.status === 'complete'
              ? 'var(--review)'
              : child.status === 'failed' || child.status === 'stopped' || child.status === 'skipped'
                ? 'var(--failed)'
                : 'var(--running)',
          fontSize: 11,
          minWidth: 64,
          textAlign: 'right',
        }}
      >
        {child.status}
      </span>
    </a>
  );
}

