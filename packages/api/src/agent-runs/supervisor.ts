import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  createWorktree as defaultCreateWorktree,
  defaultBranchName,
  defaultWorktreePath,
  startAgentRun as defaultStartAgentRun,
  type AgentRunHandle,
  type CreateWorktreeInput,
  type StartAgentRunOptions,
  type StreamEvent,
  type Worktree,
} from '@kanbots/dispatcher';
import type { AgentEvent, AgentRun, AgentRunStatus, Card, Store } from '@kanbots/local-store';

const DEFAULT_DECISION_PROMPT = `When you need a decision from the user before continuing, end your turn with a fenced code block:

\`\`\`kanbots-decision
{
  "question": "the question you want answered",
  "options": [
    {"value": "a", "label": "Option A"},
    {"value": "b", "label": "Option B"}
  ]
}
\`\`\`

After emitting the block, end your turn (do not continue working). The user will pick an option and you will resume with their choice provided as the next user message.`;

export interface CreateSupervisorOptions {
  store: Store;
  repoPath: string;
  startAgentRun?: (opts: StartAgentRunOptions) => AgentRunHandle;
  createWorktree?: (input: CreateWorktreeInput) => Promise<Worktree>;
  prepareWorktreeDir?: (path: string) => Promise<void>;
  appendSystemPromptDefault?: string;
  onRunComplete?: (run: AgentRun) => Promise<void> | void;
}

export interface StartRunInput {
  threadId: number;
  issueNumber: number;
  prompt: string;
  appendSystemPrompt?: string;
  model?: string;
}

export interface ResumeRunInput {
  runId: number;
  prompt: string;
  appendSystemPrompt?: string;
}

export type AgentEventListener = (event: AgentEvent) => void;
export type AgentStatusListener = (status: AgentRunStatus) => void;
export type CardListener = (card: Card) => void;

export interface AgentSupervisor {
  start(input: StartRunInput): Promise<AgentRun>;
  resume(input: ResumeRunInput): Promise<AgentRun>;
  stop(runId: number): Promise<AgentRun>;
  getRun(runId: number): AgentRun | null;
  listEvents(runId: number, sinceSeq?: number): AgentEvent[];
  listCards(runId: number): Card[];
  isActive(runId: number): boolean;
  subscribe(
    runId: number,
    onEvent: AgentEventListener,
    onStatus: AgentStatusListener,
    onCard?: CardListener,
  ): () => void;
}

interface ActiveRun {
  handle: AgentRunHandle;
  hasDecision: boolean;
  pendingMessageId: number | null;
}

const ACTIVE_STATUSES: ReadonlyArray<AgentRunStatus> = ['starting', 'running', 'awaiting_input'];

export function createSupervisor(opts: CreateSupervisorOptions): AgentSupervisor {
  const { store, repoPath } = opts;
  const startAgent = opts.startAgentRun ?? defaultStartAgentRun;
  const makeWorktree = opts.createWorktree ?? defaultCreateWorktree;
  const prepareDir = opts.prepareWorktreeDir ?? defaultPrepareDir;
  const decisionInstructions = opts.appendSystemPromptDefault ?? DEFAULT_DECISION_PROMPT;

  // Any 'starting'/'running' rows on construction belong to a previous app
  // process — the supervisor's in-memory handles don't survive restart, so
  // those runs are by definition dead. Mark them failed so the UI stops
  // reporting them as live, then sweep any pending decisions whose run is
  // no longer in an active state.
  store.agentRuns.markStartingRunningAsInterrupted('interrupted: app restart');
  store.cards.dismissOrphanPendingDecisions();

  const active = new Map<number, ActiveRun>();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const eventChannel = (runId: number): string => `event:${runId}`;
  const statusChannel = (runId: number): string => `status:${runId}`;
  const cardChannel = (runId: number): string => `card:${runId}`;

  function composeSystemPrompt(extra: string | undefined): string {
    if (!extra) return decisionInstructions;
    return `${decisionInstructions}\n\n${extra}`;
  }

  function ensureAgentMessage(threadId: number, runId: number, body: string): number {
    const existing = active.get(runId);
    if (existing && existing.pendingMessageId !== null) {
      return existing.pendingMessageId;
    }
    const msg = store.messages.create({
      threadId,
      role: 'agent',
      body,
      agentRunId: runId,
    });
    if (existing) existing.pendingMessageId = msg.id;
    return msg.id;
  }

  function wireHandle(run: AgentRun, handle: AgentRunHandle): void {
    const entry: ActiveRun = { handle, hasDecision: false, pendingMessageId: null };
    active.set(run.id, entry);

    handle.on('event', (streamEvent: StreamEvent) => {
      if (streamEvent.kind === 'session') {
        store.agentRuns.update(run.id, {
          sessionId: streamEvent.sessionId,
          ...(streamEvent.model !== null ? { model: streamEvent.model } : {}),
        });
        return;
      }
      if (streamEvent.kind === 'decision') {
        const messageId = ensureAgentMessage(
          run.threadId,
          run.id,
          formatDecisionMessage(streamEvent.question),
        );
        const card = store.cards.create({
          messageId,
          type: 'decision',
          payload: {
            question: streamEvent.question,
            options: streamEvent.options,
          },
        });
        entry.hasDecision = true;
        emitter.emit(cardChannel(run.id), card);
        return;
      }
      const persisted = persistEvent(store, run.id, streamEvent);
      if (persisted) emitter.emit(eventChannel(run.id), persisted);
    });

    handle.on('close', (summary) => {
      const naturalStatus: AgentRunStatus = summary.killedByStop
        ? 'stopped'
        : summary.result?.isError === true
          ? 'failed'
          : summary.exitCode === 0
            ? 'complete'
            : 'failed';
      const status: AgentRunStatus =
        entry.hasDecision && naturalStatus === 'complete' ? 'awaiting_input' : naturalStatus;
      const exitReason = summary.killedByStop
        ? 'stopped by user'
        : summary.exitCode !== 0
          ? `exit code ${summary.exitCode ?? 'null'}: ${truncate(summary.stderr, 500)}`
          : null;

      const updated = store.agentRuns.update(run.id, {
        status,
        endedAt: status === 'awaiting_input' ? null : new Date().toISOString(),
        pid: null,
        ...(summary.result?.tokenUsage
          ? {
              tokenUsageInput: summary.result.tokenUsage.input,
              tokenUsageOutput: summary.result.tokenUsage.output,
            }
          : {}),
        ...(summary.result?.totalCostUsd !== undefined && summary.result?.totalCostUsd !== null
          ? { totalCostUsd: summary.result.totalCostUsd }
          : {}),
        ...(summary.result?.durationMs !== undefined && summary.result?.durationMs !== null
          ? { durationMs: summary.result.durationMs }
          : {}),
        ...(exitReason !== null ? { exitReason } : {}),
      });
      if (status !== 'awaiting_input') {
        store.cards.dismissPendingDecisionsForRun(run.id);
      }
      active.delete(run.id);
      emitter.emit(statusChannel(run.id), updated.status);
      if (status === 'complete' && opts.onRunComplete) {
        void Promise.resolve(opts.onRunComplete(updated)).catch(() => {
          // best-effort hook; failures must not crash the supervisor
        });
      }
    });

    handle.on('error', (err) => {
      const errEvent = store.events.append({
        agentRunId: run.id,
        type: 'error',
        payload: { message: err.message },
      });
      emitter.emit(eventChannel(run.id), errEvent);
    });
  }

  async function start(input: StartRunInput): Promise<AgentRun> {
    let run = store.agentRuns.create({ threadId: input.threadId, status: 'starting' });
    const branch = defaultBranchName({
      issueNumber: input.issueNumber,
      runId: run.id,
    });
    const worktreePath = defaultWorktreePath({
      repoPath,
      issueNumber: input.issueNumber,
      runId: run.id,
    });

    try {
      await prepareDir(worktreePath);
      await makeWorktree({ repoPath, branch, worktreePath });
    } catch (err) {
      run = store.agentRuns.update(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        exitReason: `worktree: ${err instanceof Error ? err.message : String(err)}`,
      });
      return run;
    }

    run = store.agentRuns.update(run.id, {
      worktreePath,
      branchName: branch,
      ...(input.model !== undefined ? { model: input.model } : {}),
    });

    const appendPrompt = composeSystemPrompt(input.appendSystemPrompt);
    const handle = startAgent({
      cwd: worktreePath,
      prompt: input.prompt,
      appendSystemPrompt: appendPrompt,
      ...(input.model !== undefined ? { model: input.model } : {}),
    });

    run = store.agentRuns.update(run.id, {
      status: 'running',
      pid: handle.pid,
    });
    wireHandle(run, handle);
    return run;
  }

  async function resume(input: ResumeRunInput): Promise<AgentRun> {
    const existing = store.agentRuns.findById(input.runId);
    if (!existing) throw new Error(`agent run ${input.runId} not found`);
    if (active.has(input.runId)) {
      throw new Error(`agent run ${input.runId} is already active`);
    }
    if (!existing.sessionId) {
      throw new Error(`agent run ${input.runId} has no session_id to resume`);
    }
    if (!existing.worktreePath) {
      throw new Error(`agent run ${input.runId} has no worktree`);
    }

    const handle = startAgent({
      cwd: existing.worktreePath,
      prompt: input.prompt,
      resumeFromSessionId: existing.sessionId,
      appendSystemPrompt: composeSystemPrompt(input.appendSystemPrompt),
    });

    const run = store.agentRuns.update(input.runId, {
      status: 'running',
      endedAt: null,
      exitReason: null,
      pid: handle.pid,
    });
    wireHandle(run, handle);
    emitter.emit(statusChannel(run.id), run.status);
    return run;
  }

  async function stop(runId: number): Promise<AgentRun> {
    const entry = active.get(runId);
    if (entry) {
      entry.handle.stop();
      await entry.handle.done;
      const run = store.agentRuns.findById(runId);
      if (!run) throw new Error(`agent run ${runId} not found`);
      return run;
    }
    const existing = store.agentRuns.findById(runId);
    if (!existing) throw new Error(`agent run ${runId} not found`);
    if (!ACTIVE_STATUSES.includes(existing.status)) return existing;
    // No live handle but DB still says active — manual escape hatch.
    const updated = store.agentRuns.update(runId, {
      status: 'stopped',
      endedAt: new Date().toISOString(),
      pid: null,
    });
    store.cards.dismissPendingDecisionsForRun(runId);
    emitter.emit(statusChannel(runId), updated.status);
    return updated;
  }

  function getRun(runId: number): AgentRun | null {
    return store.agentRuns.findById(runId);
  }

  function listEvents(runId: number, sinceSeq?: number): AgentEvent[] {
    return store.events.list(runId, sinceSeq !== undefined ? { afterSeq: sinceSeq } : {});
  }

  function listCards(runId: number): Card[] {
    return store.cards.listByRun(runId);
  }

  function isActive(runId: number): boolean {
    if (active.has(runId)) return true;
    const run = store.agentRuns.findById(runId);
    return run !== null && ACTIVE_STATUSES.includes(run.status);
  }

  function subscribe(
    runId: number,
    onEvent: AgentEventListener,
    onStatus: AgentStatusListener,
    onCard?: CardListener,
  ): () => void {
    const eventListener = (e: AgentEvent): void => onEvent(e);
    const statusListener = (s: AgentRunStatus): void => onStatus(s);
    const cardListener = (c: Card): void => onCard?.(c);
    emitter.on(eventChannel(runId), eventListener);
    emitter.on(statusChannel(runId), statusListener);
    if (onCard) emitter.on(cardChannel(runId), cardListener);
    return () => {
      emitter.off(eventChannel(runId), eventListener);
      emitter.off(statusChannel(runId), statusListener);
      if (onCard) emitter.off(cardChannel(runId), cardListener);
    };
  }

  return { start, resume, stop, getRun, listEvents, listCards, isActive, subscribe };
}

function persistEvent(store: Store, runId: number, ev: StreamEvent): AgentEvent | null {
  switch (ev.kind) {
    case 'text':
      return store.events.append({
        agentRunId: runId,
        type: 'text',
        payload: { text: ev.text },
      });
    case 'tool_use':
      return store.events.append({
        agentRunId: runId,
        type: 'tool_use',
        payload: { toolUseId: ev.toolUseId, name: ev.name, input: ev.input },
      });
    case 'tool_result':
      return store.events.append({
        agentRunId: runId,
        type: 'tool_result',
        payload: {
          toolUseId: ev.toolUseId,
          isError: ev.isError,
          content: ev.content,
        },
      });
    case 'parse_error':
      return store.events.append({
        agentRunId: runId,
        type: 'error',
        payload: { message: ev.message, raw: ev.raw },
      });
    case 'session':
    case 'decision':
    case 'result':
      return null;
  }
}

function formatDecisionMessage(question: string): string {
  return `Awaiting decision: ${question}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

async function defaultPrepareDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
