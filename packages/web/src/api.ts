import { cardsToIssues, cardToIssue, statusFromLabels } from './cloud-adapter.js';
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
  AutopilotConfig,
  AutopilotKind,
  AutopilotSession,
  Card,
  ChatConversation,
  ChatPayload,
  ChatPostMessageResult,
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
  ProviderId,
  ProviderSaveInput,
  ProviderSettingsInput,
  ProviderTestConnectionResult,
  ProvidersPayload,
  SentryConfigInput,
  SentryConfigPayload,
  SentrySuggestion,
  SentrySyncResult,
  SentryTestConnectionResult,
  StatusKey,
  UpdateIssuePatch,
  Workspace,
  WorkspaceBudgets,
  WorkspaceFolderPayload,
  WorkspaceHouseRules,
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
  provider?: ProviderId;
  appendSystemPrompt?: string;
}

export interface DispatchIssueResult {
  run: AgentRun;
  message: Message;
}

export interface DispatchIssueInput {
  fromStatus: StatusKey | null;
  model?: string;
  provider?: ProviderId;
}

interface BridgeError extends Error {
  details?: unknown;
}

// Cloud-only launch — phase 1 unification: when a cloud workspace is open,
// `setCloudCtx` is called by the App with the active org/project slugs.
// Mode-aware api functions check `cloudCtx` and route to the cloud client
// bridge instead of local IPC; everything else stays as local-mode IPC.
// Callers don't need to know the mode — they keep calling `api.foo()`.
interface CloudCtx {
  orgSlug: string;
  projectSlug: string;
}
let cloudCtx: CloudCtx | null = null;
export function setCloudCtx(ctx: CloudCtx | null): void {
  cloudCtx = ctx;
}
export function isCloudMode(): boolean {
  return cloudCtx !== null;
}

function getCloudBridge() {
  if (typeof window === 'undefined' || !window.kanbots) {
    throw new Error('window.kanbots not available — renderer must run inside Electron');
  }
  return window.kanbots;
}

function refuseInCloud(op: string): never {
  throw new Error(`${op} is not yet available in cloud mode (phase 2-4 of the unification plan).`);
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
  if (opts.provider !== undefined) args.provider = opts.provider;
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
  if (input.provider !== undefined) args.provider = input.provider;
  return args;
}

export const api = {
  config: async (): Promise<Config> => {
    if (cloudCtx !== null) {
      // Synthetic config so renderer breadcrumbs render `orgSlug/projectSlug`.
      // `mode: 'github'` keeps the existing display branch (`owner/repo`)
      // working without widening the Config union — phase 3 will add a
      // dedicated 'cloud' mode value with a project-config endpoint.
      return {
        owner: cloudCtx.orgSlug,
        repo: cloudCtx.projectSlug,
        mode: 'github',
      };
    }
    return invoke('config:get', undefined);
  },
  issues: async (state: 'open' | 'closed' | 'all' = 'open'): Promise<Issue[]> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      const list = await bridge.cloudCardsList({
        orgSlug: cloudCtx.orgSlug,
        projectSlug: cloudCtx.projectSlug,
        query: { limit: 200 },
      });
      // `state` filtering is approximate in cloud mode: archived_at handles
      // closed-equivalent. Phase 2 may add a `state` query param if needed.
      const issues = cardsToIssues(list.data);
      if (state === 'closed') return issues.filter((i) => i.state === 'closed');
      if (state === 'open') return issues.filter((i) => i.state === 'open');
      return issues;
    }
    return invoke('issues:list', { state });
  },
  issue: async (n: number): Promise<IssueDetail> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      const [card, commentsResp] = await Promise.all([
        bridge.cloudCardsGet({
          orgSlug: cloudCtx.orgSlug,
          projectSlug: cloudCtx.projectSlug,
          number: n,
        }),
        bridge.cloudCommentsList({
          orgSlug: cloudCtx.orgSlug,
          projectSlug: cloudCtx.projectSlug,
          number: n,
        }),
      ]);
      const comments: Comment[] = commentsResp.data.map((c) => ({
        id: Number(c.id),
        body: c.body,
        user: { login: 'cloud-user', avatarUrl: null },
        createdAt: c.created_at,
        updatedAt: c.edited_at ?? c.created_at,
        htmlUrl: '',
      }));
      // Agent thread (chat history) requires runs + events — wired in
      // phase 4 once the SSE multiplexer lands.
      return { issue: cardToIssue(card), comments, thread: null };
    }
    return invoke('issues:get', { number: n });
  },
  updateIssue: async (n: number, patch: UpdateIssuePatch): Promise<Issue> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      // Only label-driven status updates are wired in phase 1 — that's what
      // drag-drop dispatches. Title/body edits route through the same
      // endpoint but aren't surfaced from Board today.
      const nextStatus = patch.labels ? statusFromLabels(patch.labels) : null;
      if (nextStatus === null && patch.title === undefined && patch.body === undefined) {
        refuseInCloud(`api.updateIssue (no status/title/body in patch)`);
      }
      const body: Parameters<typeof bridge.cloudCardsUpdate>[0]['body'] = {};
      if (nextStatus !== null) body.status = nextStatus;
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.body !== undefined) body.body = patch.body;
      const updated = await bridge.cloudCardsUpdate({
        orgSlug: cloudCtx.orgSlug,
        projectSlug: cloudCtx.projectSlug,
        number: n,
        body,
      });
      return cardToIssue(updated);
    }
    return invoke('issues:patch', { number: n, patch });
  },
  addComment: async (n: number, body: string): Promise<Comment> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      const created = await bridge.cloudCommentsAdd({
        orgSlug: cloudCtx.orgSlug,
        projectSlug: cloudCtx.projectSlug,
        number: n,
        body,
      });
      // CommentSummary → renderer Comment: stub the GitHub-shaped user.
      return {
        id: Number(created.id),
        body: created.body,
        user: { login: 'cloud-user', avatarUrl: null },
        createdAt: created.created_at,
        updatedAt: created.edited_at ?? created.created_at,
        htmlUrl: '',
      };
    }
    return invoke('issues:add-comment', { number: n, body });
  },
  postMessage: (
    n: number,
    body: string,
    opts: PostMessageOptions = {},
  ): Promise<PostMessageResult> =>
    invoke('issues:post-message', buildPostMessageArgs(n, body, opts)),
  createIssue: async (input: CreateIssueInput): Promise<Issue> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      const created = await bridge.cloudCardsCreate({
        orgSlug: cloudCtx.orgSlug,
        projectSlug: cloudCtx.projectSlug,
        body: { title: input.title, ...(input.body !== undefined ? { body: input.body } : {}) },
      });
      return cardToIssue(created);
    }
    return invoke('issues:create', input);
  },
  draftIssue: (description: string): Promise<DraftedIssue> =>
    invoke('composer:draft', { description }),
  suggestFeature: (
    personaPrompt: string,
    provider?: ProviderId,
  ): Promise<DraftedIssue> => {
    const args: ChannelArgs<'composer:suggest'> = { personaPrompt };
    if (provider !== undefined) args.provider = provider;
    return invoke('composer:suggest', args);
  },
  startAgent: (
    issueNumber: number,
    input: {
      threadId: number;
      prompt: string;
      appendSystemPrompt?: string;
      model?: string;
      provider?: ProviderId;
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
    if (input.provider !== undefined) args.provider = input.provider;
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
  revealAgentRunWorktree: (runId: number): Promise<{ worktreePath: string }> =>
    invoke('agent-runs:reveal-worktree', { runId }),
  getAgentRunStats: (
    runId: number,
  ): Promise<{ additions: number; deletions: number; filesChanged: number }> =>
    invoke('agent-runs:stats', { runId }),
  listIssueRuns: (issueNumber: number): Promise<AgentRun[]> =>
    invoke('issues:list-runs', { number: issueNumber }),
  listPendingDecisions: (): Promise<PendingDecisionPayload[]> => {
    if (cloudCtx !== null) return Promise.resolve([]);
    return invoke('decisions:pending', undefined);
  },
  workspace: async (): Promise<Workspace> => {
    if (cloudCtx !== null) {
      // Synthetic — phase 3 ships a real project-config endpoint that will
      // back this with cloud workspace metadata.
      return {
        id: `${cloudCtx.orgSlug}/${cloudCtx.projectSlug}`,
        name: cloudCtx.projectSlug,
        currentFolderId: '',
      };
    }
    return invoke('workspace:get', undefined);
  },
  getWorkspaceBudgets: (): Promise<WorkspaceBudgets> =>
    invoke('workspace:get-budgets', undefined),
  setWorkspaceBudgets: (input: WorkspaceBudgets): Promise<WorkspaceBudgets> =>
    invoke('workspace:set-budgets', input),
  getWorkspaceHouseRules: (): Promise<WorkspaceHouseRules> =>
    invoke('workspace:get-house-rules', undefined),
  setWorkspaceHouseRules: (input: WorkspaceHouseRules): Promise<WorkspaceHouseRules> =>
    invoke('workspace:set-house-rules', input),
  listFolders: (): Promise<WorkspaceFolderPayload[]> => {
    if (cloudCtx !== null) return Promise.resolve([]);
    return invoke('folders:list', undefined);
  },
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
  getCheckCommands: (): Promise<
    Record<'typecheck' | 'tests' | 'lint' | 'e2e', { command: string; args: string[] }>
  > => invoke('agent-runs:checks:commands', undefined),
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
  unarchiveIssue: (issueNumber: number): Promise<Issue> =>
    invoke('issues:unarchive', { number: issueNumber }),
  listArchivedIssues: (): Promise<Issue[]> =>
    invoke('issues:list-archived', undefined),
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
  costToday: async (): Promise<{ totalUsd: number; since: string }> => {
    if (cloudCtx !== null) {
      const bridge = getCloudBridge();
      return bridge.cloudCostToday(cloudCtx.orgSlug);
    }
    return invoke('cost:today', undefined);
  },
  costUsage: async (): Promise<ChannelResult<'cost:usage'>> => {
    if (cloudCtx !== null) {
      // Phase 2: replace with cloud billing usage endpoint.
      return { fiveHour: null, sevenDay: null, source: 'unavailable' };
    }
    return invoke('cost:usage', undefined);
  },
  costBreakdown: (): Promise<ChannelResult<'cost:breakdown'>> =>
    invoke('cost:breakdown', undefined),
  costRollup: (
    args: ChannelArgs<'analytics:rollup'> = {},
  ): Promise<ChannelResult<'analytics:rollup'>> => invoke('analytics:rollup', args),
  costTimeSeries: (
    args: ChannelArgs<'analytics:time-series'>,
  ): Promise<ChannelResult<'analytics:time-series'>> => invoke('analytics:time-series', args),
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
  startAutopilot: (input: {
    kind: AutopilotKind;
    title?: string;
    config: AutopilotConfig;
  }): Promise<{ sessionId: number; issueNumber: number }> => {
    const args: ChannelArgs<'autopilot:start'> = { kind: input.kind, config: input.config };
    if (input.title !== undefined) args.title = input.title;
    return invoke('autopilot:start', args);
  },
  stopAutopilot: (
    sessionId: number,
    opts: { stopChildren: boolean },
  ): Promise<{ sessionId: number }> =>
    invoke('autopilot:stop', { sessionId, stopChildren: opts.stopChildren }),
  listActiveAutopilots: (): Promise<AutopilotSession[]> =>
    invoke('autopilot:list-active', undefined),
  getAutopilotByIssue: (issueNumber: number): Promise<AutopilotSession | null> =>
    invoke('autopilot:get-by-issue', { issueNumber }),
  getSentryConfig: (): Promise<SentryConfigPayload> =>
    invoke('sentry:get-config', undefined),
  saveSentryConfig: (input: SentryConfigInput): Promise<SentryConfigPayload> =>
    invoke('sentry:save-config', input),
  testSentryConnection: (input: {
    token?: string;
    orgSlug?: string;
    projectSlug?: string;
  } = {}): Promise<SentryTestConnectionResult> =>
    invoke('sentry:test-connection', input),
  syncSentryNow: (): Promise<SentrySyncResult> =>
    invoke('sentry:sync-now', undefined),
  analyzeSentryIssue: (issueNumber: number): Promise<SentrySuggestion> =>
    invoke('sentry:analyze', { issueNumber }),
  applySentrySuggestion: (issueNumber: number): Promise<Issue> =>
    invoke('sentry:apply-suggestion', { issueNumber }),
  getProviders: (): Promise<ProvidersPayload> => invoke('providers:get', undefined),
  saveProvider: (input: ProviderSaveInput): Promise<ProvidersPayload> =>
    invoke('providers:save', input),
  testProviderConnection: (
    input: { id: ProviderId; apiKey?: string },
  ): Promise<ProviderTestConnectionResult> =>
    invoke('providers:test-connection', input),
  setProviderDefaults: (input: ProviderSettingsInput): Promise<ProvidersPayload> =>
    invoke('providers:set-defaults', input),
  listChats: (): Promise<ChatConversation[]> => {
    if (cloudCtx !== null) return Promise.resolve([]);
    return invoke('chat:list', undefined);
  },
  createChat: (title?: string): Promise<ChatPayload> => {
    const args: ChannelArgs<'chat:create'> = title !== undefined ? { title } : {};
    return invoke('chat:create', args);
  },
  getChat: (conversationId: number): Promise<ChatPayload> =>
    invoke('chat:get', { conversationId }),
  renameChat: (conversationId: number, title: string): Promise<ChatConversation> =>
    invoke('chat:rename', { conversationId, title }),
  deleteChat: (conversationId: number): Promise<{ ok: true }> =>
    invoke('chat:delete', { conversationId }),
  postChatMessage: (
    conversationId: number,
    body: string,
    opts: PostMessageOptions = {},
  ): Promise<ChatPostMessageResult> => {
    const args: ChannelArgs<'chat:post-message'> = { conversationId, body };
    if (opts.dispatch !== undefined) args.dispatch = opts.dispatch;
    if (opts.model !== undefined) args.model = opts.model;
    if (opts.provider !== undefined) args.provider = opts.provider;
    if (opts.appendSystemPrompt !== undefined) {
      args.appendSystemPrompt = opts.appendSystemPrompt;
    }
    return invoke('chat:post-message', args);
  },
  stopChatRun: (runId: number): Promise<AgentRun> => invoke('chat:stop-run', { runId }),
} as const;
