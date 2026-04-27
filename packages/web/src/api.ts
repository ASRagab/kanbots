import type {
  ChannelArgs,
  ChannelName,
  ChannelResult,
  PostMessageResult,
  UploadAttachmentResult,
} from './global.js';
import type {
  AgentCheck,
  AgentRun,
  Card,
  Comment,
  Config,
  CreateIssueInput,
  DiffPayload,
  DraftedIssue,
  Issue,
  IssueDetail,
  Message,
  PendingDecisionPayload,
  PreviewStatePayload,
  StatusKey,
  UpdateIssuePatch,
  Workspace,
  WorkspaceFolderPayload,
} from './types.js';

export type { PostMessageResult, UploadAttachmentResult } from './global.js';

export interface ResolveCardResult {
  card: Card;
  run: AgentRun;
}

export interface DismissCardResult {
  card: Card;
  run: AgentRun;
}

export interface PostMessageOptions {
  dispatch?: boolean;
  model?: string;
  appendSystemPrompt?: string;
}

export interface DispatchIssueResult {
  run: AgentRun;
  message: Message;
}

export interface DispatchIssueInput {
  fromStatus: StatusKey | null;
  model?: string;
}

interface BridgeError extends Error {
  details?: unknown;
}

function invoke<C extends ChannelName>(
  channel: C,
  args: ChannelArgs<C>,
): Promise<ChannelResult<C>> {
  if (typeof window === 'undefined' || !window.kanbots?.invoke) {
    return Promise.reject(
      new Error('window.kanbots not available — renderer must run inside Electron'),
    );
  }
  return window.kanbots.invoke(channel, args).catch((err: unknown) => {
    throw translateBridgeError(err);
  });
}

// IPC serializes errors to plain Error with a JSON-encoded message of
// shape { name, message, details? }. Unwrap so renderer code can branch
// on err.name (e.g. 'AlreadyActive', 'NotFound', 'ValidationError').
function translateBridgeError(err: unknown): Error {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message) as {
        name?: unknown;
        message?: unknown;
        details?: unknown;
      };
      if (typeof parsed.message === 'string') {
        const next: BridgeError = new Error(parsed.message);
        if (typeof parsed.name === 'string' && parsed.name.length > 0) {
          next.name = parsed.name;
        }
        if (parsed.details !== undefined) next.details = parsed.details;
        return next;
      }
    } catch {
      // not a JSON envelope; fall through and return original
    }
    return err;
  }
  return new Error(String(err));
}

function buildPostMessageArgs(
  n: number,
  body: string,
  opts: PostMessageOptions,
): ChannelArgs<'issues:post-message'> {
  const args: ChannelArgs<'issues:post-message'> = { number: n, body };
  if (opts.dispatch !== undefined) args.dispatch = opts.dispatch;
  if (opts.model !== undefined) args.model = opts.model;
  if (opts.appendSystemPrompt !== undefined) {
    args.appendSystemPrompt = opts.appendSystemPrompt;
  }
  return args;
}

function buildDispatchArgs(
  n: number,
  input: DispatchIssueInput,
): ChannelArgs<'issues:dispatch'> {
  const args: ChannelArgs<'issues:dispatch'> = {
    number: n,
    fromStatus: input.fromStatus,
  };
  if (input.model !== undefined) args.model = input.model;
  return args;
}

export const api = {
  config: (): Promise<Config> => invoke('config:get', undefined),
  issues: (state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> =>
    invoke('issues:list', { state }),
  issue: (n: number): Promise<IssueDetail> => invoke('issues:get', { number: n }),
  updateIssue: (n: number, patch: UpdateIssuePatch): Promise<Issue> =>
    invoke('issues:patch', { number: n, patch }),
  addComment: (n: number, body: string): Promise<Comment> =>
    invoke('issues:add-comment', { number: n, body }),
  postMessage: (
    n: number,
    body: string,
    opts: PostMessageOptions = {},
  ): Promise<PostMessageResult> =>
    invoke('issues:post-message', buildPostMessageArgs(n, body, opts)),
  createIssue: (input: CreateIssueInput): Promise<Issue> => invoke('issues:create', input),
  draftIssue: (description: string): Promise<DraftedIssue> =>
    invoke('composer:draft', { description }),
  suggestFeature: (personaPrompt: string): Promise<DraftedIssue> =>
    invoke('composer:suggest', { personaPrompt }),
  startAgent: (
    issueNumber: number,
    input: {
      threadId: number;
      prompt: string;
      appendSystemPrompt?: string;
      model?: string;
    },
  ): Promise<AgentRun> => {
    const args: ChannelArgs<'issues:start-agent'> = {
      number: issueNumber,
      threadId: input.threadId,
      prompt: input.prompt,
    };
    if (input.appendSystemPrompt !== undefined) {
      args.appendSystemPrompt = input.appendSystemPrompt;
    }
    if (input.model !== undefined) args.model = input.model;
    return invoke('issues:start-agent', args);
  },
  dispatchIssue: (
    issueNumber: number,
    input: DispatchIssueInput,
  ): Promise<DispatchIssueResult> =>
    invoke('issues:dispatch', buildDispatchArgs(issueNumber, input)),
  stopAgent: (runId: number): Promise<AgentRun> => invoke('agent-runs:stop', { runId }),
  getAgentRun: (runId: number): Promise<AgentRun> => invoke('agent-runs:get', { runId }),
  getAgentRunDiff: (runId: number): Promise<DiffPayload> =>
    invoke('agent-runs:diff', { runId }),
  getAgentRunStats: (
    runId: number,
  ): Promise<{ additions: number; deletions: number; filesChanged: number }> =>
    invoke('agent-runs:stats', { runId }),
  listIssueRuns: (issueNumber: number): Promise<AgentRun[]> =>
    invoke('issues:list-runs', { number: issueNumber }),
  listPendingDecisions: (): Promise<PendingDecisionPayload[]> =>
    invoke('decisions:pending', undefined),
  workspace: (): Promise<Workspace> => invoke('workspace:get', undefined),
  listFolders: (): Promise<WorkspaceFolderPayload[]> => invoke('folders:list', undefined),
  addFolder: (input: {
    name: string;
    path: string;
    defaultBranch?: string;
  }): Promise<WorkspaceFolderPayload> => {
    const args: ChannelArgs<'folders:add'> = { name: input.name, path: input.path };
    if (input.defaultBranch !== undefined) args.defaultBranch = input.defaultBranch;
    return invoke('folders:add', args);
  },
  getAgentRunChecks: (runId: number): Promise<AgentCheck[]> =>
    invoke('agent-runs:checks:list', { runId }),
  runAgentRunChecks: (
    runId: number,
    kinds?: Array<'typecheck' | 'tests' | 'lint' | 'e2e'>,
  ): Promise<AgentCheck[]> => {
    const args: ChannelArgs<'agent-runs:checks:run'> = { runId };
    if (kinds !== undefined) args.kinds = kinds;
    return invoke('agent-runs:checks:run', args);
  },
  getAgentRunPreview: (runId: number): Promise<PreviewStatePayload> =>
    invoke('agent-runs:preview:get', { runId }),
  startAgentRunPreview: (runId: number): Promise<PreviewStatePayload> =>
    invoke('agent-runs:preview:start', { runId }),
  stopAgentRunPreview: (runId: number): Promise<PreviewStatePayload> =>
    invoke('agent-runs:preview:stop', { runId }),
  approveIssue: (issueNumber: number): Promise<Issue> =>
    invoke('issues:approve', { number: issueNumber }),
  requestChangesIssue: (issueNumber: number): Promise<Issue> =>
    invoke('issues:request-changes', { number: issueNumber }),
  archiveIssue: (issueNumber: number): Promise<Issue> =>
    invoke('issues:archive', { number: issueNumber }),
  splitIssue: (
    issueNumber: number,
    subtasks: Array<{ title: string; body?: string }>,
    opts: { dispatch?: boolean } = {},
  ): Promise<{ parent: number; children: Issue[] }> =>
    invoke('issues:split', {
      number: issueNumber,
      subtasks,
      dispatch: opts.dispatch ?? false,
    }),
  spawnReviewer: (
    issueNumber: number,
    opts: { threadId?: number; prompt?: string; model?: string } = {},
  ): Promise<AgentRun> => {
    const args: ChannelArgs<'issues:reviewer'> = { number: issueNumber };
    if (opts.threadId !== undefined) args.threadId = opts.threadId;
    if (opts.prompt !== undefined) args.prompt = opts.prompt;
    if (opts.model !== undefined) args.model = opts.model;
    return invoke('issues:reviewer', args);
  },
  forkAgentRun: (
    runId: number,
  ): Promise<{ source: number; run: AgentRun; worktree: string; branch: string }> =>
    invoke('agent-runs:fork', { runId }),
  promoteCommit: (
    runId: number,
  ): Promise<ChannelResult<'agent-runs:promote-commit'>> =>
    invoke('agent-runs:promote-commit', { runId }),
  promotePR: (
    runId: number,
  ): Promise<ChannelResult<'agent-runs:promote-pr'>> =>
    invoke('agent-runs:promote-pr', { runId }),
  costToday: (): Promise<{ totalUsd: number; since: string }> =>
    invoke('cost:today', undefined),
  resolveCard: (cardId: number, value: string): Promise<ResolveCardResult> =>
    invoke('cards:resolve', { cardId, value }),
  dismissCard: (cardId: number): Promise<DismissCardResult> =>
    invoke('cards:dismiss', { cardId }),
  uploadAttachment: async (file: Blob): Promise<UploadAttachmentResult> => {
    const data = new Uint8Array(await file.arrayBuffer());
    return invoke('attachments:upload', {
      contentType: file.type || 'application/octet-stream',
      data,
    });
  },
} as const;
