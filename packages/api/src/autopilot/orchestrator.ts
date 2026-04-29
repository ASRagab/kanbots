import type { IssueSource } from '@kanbots/core';
import type {
  AgentRunStatus,
  AutopilotChildEntry,
  AutopilotConfig,
  AutopilotKind,
  AutopilotSession,
  Store,
} from '@kanbots/local-store';
import type { AgentSupervisor } from '../agent-runs/supervisor.js';
import type { SuggestFeatureFn } from '../bridge.js';
import { runFeatureDevLoop } from './feature-dev.js';

export interface AutopilotRepoConfig {
  owner: string;
  repo: string;
}

export interface AutopilotManagerOpts {
  store: Store;
  source: IssueSource;
  supervisor: AgentSupervisor;
  suggestIssue: SuggestFeatureFn;
  repoPath: string;
  repoConfig: AutopilotRepoConfig;
  onSessionChange?: (session: AutopilotSession) => void;
}

export interface StartAutopilotInput {
  kind: AutopilotKind;
  title?: string;
  config: AutopilotConfig;
  ownerLabel?: string;
}

export interface StartAutopilotResult {
  session: AutopilotSession;
  issueNumber: number;
}

export interface AutopilotManager {
  start(input: StartAutopilotInput): Promise<StartAutopilotResult>;
  stop(sessionId: number, opts: { stopChildren: boolean }): Promise<AutopilotSession>;
  getSession(sessionId: number): AutopilotSession | null;
  getSessionByIssue(issueNumber: number): AutopilotSession | null;
  listActive(): AutopilotSession[];
  stopAllForShutdown(): Promise<void>;
}

interface ActiveLoop {
  controller: AbortController;
  done: Promise<void>;
}

export interface OrchestratorContext {
  store: Store;
  source: IssueSource;
  supervisor: AgentSupervisor;
  suggestIssue: SuggestFeatureFn;
  repoPath: string;
  repoConfig: AutopilotRepoConfig;
  notify: (session: AutopilotSession) => void;
  setCurrentChildRunId: (sessionId: number, runId: number | null) => AutopilotSession;
}

export function createAutopilotManager(opts: AutopilotManagerOpts): AutopilotManager {
  const { store, source, supervisor, suggestIssue, repoPath, repoConfig } = opts;
  const active = new Map<number, ActiveLoop>();

  // Restart sweep — runs once on construction. Must be AFTER createSupervisor's
  // own sweep so that current_child_run_id doesn't reference a row still
  // marked 'running'.
  store.autopilotSessions.markRunningAsInterrupted('interrupted: app restart');

  function notify(session: AutopilotSession): void {
    if (opts.onSessionChange) opts.onSessionChange(session);
  }

  function setCurrentChildRunId(sessionId: number, runId: number | null): AutopilotSession {
    const updated = store.autopilotSessions.update(sessionId, { currentChildRunId: runId });
    notify(updated);
    return updated;
  }

  const ctx: OrchestratorContext = {
    store,
    source,
    supervisor,
    suggestIssue,
    repoPath,
    repoConfig,
    notify,
    setCurrentChildRunId,
  };

  async function start(input: StartAutopilotInput): Promise<StartAutopilotResult> {
    const title = input.title ?? defaultTitleFor(input.kind, input.config);
    const body = renderConfigBody(input.kind, input.config);

    const issue = await source.createIssue({
      title,
      body,
      labels: [
        'type:autopilot',
        `subtype:${input.kind}`,
        'status:in-progress',
      ],
    });

    const session = store.autopilotSessions.create({
      issueNumber: issue.number,
      kind: input.kind,
      config: input.config,
    });
    notify(session);

    const controller = new AbortController();
    const done = runLoop(input.kind, session, controller.signal).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      const failed = store.autopilotSessions.update(session.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        stopReason: `loop crashed: ${message}`,
      });
      notify(failed);
    });
    active.set(session.id, { controller, done });

    return { session, issueNumber: issue.number };
  }

  async function runLoop(
    kind: AutopilotKind,
    session: AutopilotSession,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (kind === 'feature-dev') {
        await runFeatureDevLoop(ctx, session, signal);
      } else {
        // QA modes ship in v2/v3.
        throw new Error(`Autopilot kind '${kind}' is not implemented yet`);
      }
    } finally {
      const finalSession = store.autopilotSessions.findById(session.id);
      if (finalSession && finalSession.status === 'running') {
        const settled = store.autopilotSessions.update(session.id, {
          status: signal.aborted ? 'stopped' : 'completed',
          endedAt: new Date().toISOString(),
          stopReason: signal.aborted ? finalSession.stopReason ?? 'stopped' : null,
          currentChildRunId: null,
        });
        notify(settled);
      }
      active.delete(session.id);
    }
  }

  async function stop(
    sessionId: number,
    opts2: { stopChildren: boolean },
  ): Promise<AutopilotSession> {
    const existing = store.autopilotSessions.findById(sessionId);
    if (!existing) throw new Error(`autopilot session ${sessionId} not found`);
    if (existing.status !== 'running') return existing;

    const updated = store.autopilotSessions.update(sessionId, {
      stopReason: opts2.stopChildren
        ? 'stopped by user (children cancelled)'
        : 'stopped by user (children finishing)',
    });
    notify(updated);

    const loop = active.get(sessionId);
    if (loop) loop.controller.abort();

    if (opts2.stopChildren) {
      // With parallelism > 1, multiple children may be in flight — stop all of
      // them rather than just the most recently started one.
      const activeChildIds = existing.children
        .filter((c) => c.status === 'running' && c.runId !== null)
        .map((c) => c.runId as number);
      await Promise.allSettled(activeChildIds.map((id) => supervisor.stop(id)));
    }

    if (loop) {
      try {
        await loop.done;
      } catch {
        // already handled by runLoop finally
      }
    }

    const after = store.autopilotSessions.findById(sessionId);
    if (!after) throw new Error(`autopilot session ${sessionId} disappeared`);
    if (after.status === 'running') {
      const final = store.autopilotSessions.update(sessionId, {
        status: 'stopped',
        endedAt: new Date().toISOString(),
        currentChildRunId: null,
      });
      notify(final);
      return final;
    }
    return after;
  }

  function getSession(sessionId: number): AutopilotSession | null {
    return store.autopilotSessions.findById(sessionId);
  }

  function getSessionByIssue(issueNumber: number): AutopilotSession | null {
    return store.autopilotSessions.findByIssueNumber(issueNumber);
  }

  function listActive(): AutopilotSession[] {
    return store.autopilotSessions.listActive();
  }

  async function stopAllForShutdown(): Promise<void> {
    const ids = [...active.keys()];
    for (const id of ids) {
      const loop = active.get(id);
      if (!loop) continue;
      loop.controller.abort();
      const session = store.autopilotSessions.findById(id);
      if (session && session.status === 'running') {
        store.autopilotSessions.update(id, {
          status: 'stopped',
          endedAt: new Date().toISOString(),
          stopReason: 'app shutdown',
          currentChildRunId: null,
        });
      }
    }
    await Promise.allSettled(ids.map((id) => active.get(id)?.done));
  }

  return {
    start,
    stop,
    getSession,
    getSessionByIssue,
    listActive,
    stopAllForShutdown,
  };
}

export type TerminalChildStatus = Extract<
  AgentRunStatus,
  'complete' | 'failed' | 'stopped' | 'awaiting_input'
>;

const TERMINAL_FOR_AUTOPILOT: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>([
  'complete',
  'failed',
  'stopped',
  'awaiting_input',
]);

export interface WaitForChildSettledResult {
  finalStatus: TerminalChildStatus;
  dismissedDecision: boolean;
}

export async function waitForChildSettled(
  supervisor: AgentSupervisor,
  store: Store,
  runId: number,
  signal: AbortSignal,
): Promise<WaitForChildSettledResult> {
  const initial = supervisor.getRun(runId);
  if (initial && isTerminalStatus(initial.status)) {
    return finishChild(store, runId, initial.status);
  }

  return new Promise<WaitForChildSettledResult>((resolve) => {
    let resolved = false;
    let unsubscribe: (() => void) | null = null;

    const cleanup = (): void => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          // ignore
        }
        unsubscribe = null;
      }
      signal.removeEventListener('abort', onAbort);
    };

    const settle = (status: TerminalChildStatus): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(finishChild(store, runId, status));
    };

    const onAbort = (): void => settle('stopped');
    signal.addEventListener('abort', onAbort, { once: true });

    unsubscribe = supervisor.subscribe(
      runId,
      () => {
        // events drive nothing here
      },
      (status) => {
        if (isTerminalStatus(status)) settle(status);
      },
    );
  });
}

function isTerminalStatus(status: AgentRunStatus): status is TerminalChildStatus {
  return TERMINAL_FOR_AUTOPILOT.has(status);
}

function finishChild(
  store: Store,
  runId: number,
  status: TerminalChildStatus,
): WaitForChildSettledResult {
  let dismissedDecision = false;
  if (status === 'awaiting_input') {
    const dismissed = store.cards.dismissPendingDecisionsForRun(runId);
    dismissedDecision = dismissed > 0;
  }
  return { finalStatus: status, dismissedDecision };
}

function defaultTitleFor(kind: AutopilotKind, config: AutopilotConfig): string {
  if (kind === 'feature-dev' && config.kind === 'feature-dev') {
    const names = config.personas.map((p) => p.name).join(' / ');
    return `Autopilot — Feature Dev (${names})`;
  }
  if (kind === 'qa' && config.kind === 'qa') {
    const parts = [
      ...config.checks.map((c) => c.kind),
      ...(config.liveUi ? ['live-ui'] : []),
    ];
    return `Autopilot — QA (${parts.join(', ')})`;
  }
  return `Autopilot — ${kind}`;
}

function renderConfigBody(kind: AutopilotKind, config: AutopilotConfig): string {
  const lines: string[] = [];
  lines.push(
    'This is an autopilot task. It is managed by the orchestrator and updates as it runs.',
  );
  lines.push('');
  lines.push(`**Mode:** ${kind}`);
  if (kind === 'feature-dev' && config.kind === 'feature-dev') {
    lines.push(`**Model:** ${config.model ?? 'default'}`);
    lines.push(`**Effort:** ${config.effort ?? 'medium'}`);
    lines.push(`**Parallelism:** ${config.parallelism ?? 1}`);
    lines.push('**Personas (round-robin):**');
    for (const p of config.personas) {
      lines.push(`- ${p.name}`);
    }
  } else if (kind === 'qa' && config.kind === 'qa') {
    if (config.checks.length > 0) {
      lines.push('**Checks:**');
      for (const c of config.checks) {
        lines.push(`- ${c.kind}: \`${c.command} ${c.args.join(' ')}\``);
      }
    }
    if (config.liveUi && config.devServer) {
      lines.push(
        `**Live UI testing:** \`${config.devServer.command} ${config.devServer.args.join(' ')}\``,
      );
    }
  }
  return lines.join('\n');
}

export type { AutopilotChildEntry };
