import type {
  AgentCheck,
  AgentEvent,
  AgentEventType,
  AgentRun,
  AgentRunStatus,
  AutopilotCheckCommand,
  AutopilotChildEntry,
  AutopilotChildKind,
  AutopilotChildStatus,
  AutopilotConfig,
  AutopilotEffort,
  AutopilotKind,
  AutopilotPersonaSnapshot,
  AutopilotSession,
  AutopilotStatus,
  Card,
  CardStatus,
  CardType,
  CheckKind,
  Message,
  PreviewState,
  Role,
  SentryImportStatus,
  SentrySuggestion,
  SentrySuggestionCategory,
  SentrySuggestionConfidence,
  SentrySuggestionVerdict,
} from '@kanbots/local-store';
import type {
  AgentKey,
  Comment,
  CreateIssueInput,
  Issue,
  PullRequest,
  StatusKey,
  UpdateIssuePatch,
} from '@kanbots/core';

export type {
  AgentCheck,
  AgentEvent,
  AgentEventType,
  AgentRun,
  AgentRunStatus,
  AutopilotCheckCommand,
  AutopilotChildEntry,
  AutopilotChildKind,
  AutopilotChildStatus,
  AutopilotConfig,
  AutopilotEffort,
  AutopilotKind,
  AutopilotPersonaSnapshot,
  AutopilotSession,
  AutopilotStatus,
  Card,
  CardStatus,
  CardType,
  CheckKind,
  Message,
  PreviewState,
  Role,
  AgentKey,
  Comment,
  CreateIssueInput,
  Issue,
  StatusKey,
  UpdateIssuePatch,
  SentryImportStatus,
  SentrySuggestion,
  SentrySuggestionCategory,
  SentrySuggestionConfidence,
  SentrySuggestionVerdict,
};

export interface DecisionPayload {
  question: string;
  options: Array<{ value: string; label: string }>;
}

export interface Config {
  owner: string;
  repo: string;
  mode?: 'github' | 'local';
  repoPath?: string;
  authorLogin?: string;
}

export interface DraftIssueInput {
  description: string;
}

export interface DraftedIssue {
  title: string;
  body: string;
}

export type DraftIssueFn = (input: DraftIssueInput) => Promise<DraftedIssue>;

export type SuggestFeatureEntryStatus =
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'closed'
  | 'unlabeled';

export interface SuggestFeatureBacklogEntry {
  title: string;
  body?: string;
  status?: SuggestFeatureEntryStatus;
  number?: number;
}

export interface SuggestFeatureInput {
  backlog: SuggestFeatureBacklogEntry[];
  personaPrompt: string;
}

export type SuggestFeatureFn = (input: SuggestFeatureInput) => Promise<DraftedIssue>;

export interface SentryAnalyzerInput {
  errorType: string | null;
  errorValue: string | null;
  culprit: string | null;
  permalink: string | null;
  environment: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  stackFrames: Array<{
    filename: string | null;
    function: string | null;
    lineno: number | null;
    inApp: boolean;
    contextLine: string | null;
  }>;
  breadcrumbs: Array<{
    timestamp: string | null;
    category: string | null;
    level: string | null;
    message: string | null;
  }>;
}

export type SentryAnalyzerFn = (input: SentryAnalyzerInput) => Promise<SentrySuggestion>;

export interface SentryConfigPayload {
  enabled: boolean;
  orgSlug: string | null;
  projectSlug: string | null;
  hasToken: boolean;
  tokenEncryption: 'safe' | 'plain';
  safeStorageAvailable: boolean;
  pollIntervalSeconds: number;
  environmentFilter: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  consecutiveAuthFailures: number;
}

export interface SentryConfigInput {
  enabled?: boolean;
  orgSlug?: string | null;
  projectSlug?: string | null;
  token?: string | null;
  pollIntervalSeconds?: number;
  environmentFilter?: string | null;
}

export interface SentryTestConnectionResult {
  ok: true;
  project: { slug: string; name: string };
}

export interface SentrySyncResult {
  imported: number;
  updated: number;
  totalSeen: number;
  lastSyncedAt: string;
}

export interface SentryMetaPayload {
  sentryIssueId: string;
  status: SentryImportStatus;
  count: number;
  permalink: string | null;
  culprit: string | null;
  errorType: string | null;
  errorValue: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  analyzedAt: string | null;
  suggestion: SentrySuggestion | null;
}

export interface IssueActiveRunPayload {
  id: number;
  status: AgentRunStatus;
  branch: string | null;
  model: string | null;
  startedAt: string;
  currentTool: string | null;
  currentArg: string | null;
  totalCostUsd: number | null;
  pendingDecision:
    | { question: string; options: Array<{ value: string; label: string }> }
    | null;
  checks: {
    typecheck: 'pass' | 'fail' | 'running' | 'idle';
    tests: 'pass' | 'fail' | 'running' | 'idle';
    lint: 'pass' | 'fail' | 'running' | 'idle';
  } | null;
  previewUrl: string | null;
  previewState: string | null;
  // Reserved for Phase 11 (agent intelligence) — currently unset by the
  // API but exposed so renderer code can light up when populated.
  additions?: number | null;
  deletions?: number | null;
  filesChanged?: number | null;
  progress?: number | null;
}

export interface DecoratedIssue extends Issue {
  status: StatusKey | null;
  agent: AgentKey | null;
  activeRun: IssueActiveRunPayload | null;
  sentryMeta: SentryMetaPayload | null;
}

export interface ThreadPayload {
  id: number;
  createdAt: string;
  messages: Message[];
  activeRun: AgentRun | null;
  latestRun: AgentRun | null;
}

export interface IssueDetail {
  issue: DecoratedIssue;
  comments: Comment[];
  thread: ThreadPayload | null;
}

export interface PostMessageResult {
  message: Message;
  thread: ThreadPayload | null;
  dispatchError?: string;
}

export interface DispatchResult {
  run: AgentRun;
  message: Message;
}

export interface SplitResult {
  parent: number;
  children: DecoratedIssue[];
}

export interface ResolveCardResult {
  card: Card;
  run: AgentRun;
}

export interface DismissCardResult {
  card: Card;
  run: AgentRun;
}

export interface ForkRunResult {
  source: number;
  run: AgentRun;
  worktree: string;
  branch: string;
}

export interface RunStatsResult {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface PromoteCommitResult {
  commitSha: string;
  base: string;
  cleanup: {
    worktreeRemoved: boolean;
    branchDeleted: boolean;
  };
}

export interface PromotePrResult {
  pr: PullRequest;
}

export interface EventSubscribeResult {
  subscriptionId: string;
  runStatus: AgentRunStatus;
}

export interface CostTodayResult {
  totalUsd: number;
  since: string;
}

// Same shape Claude Code's `statusLine` JSON exposes under
// `rate_limits.{five_hour,seven_day}.used_percentage`. Sourced from the
// authenticated OAuth `/usage` endpoint so the values match claude.ai's
// "Plan usage limits" panel exactly.
export interface CostUsageWindow {
  pct: number; // 0..1 utilization
  resetsAt: string | null; // ISO date or null when unknown
}

export interface CostUsageResult {
  fiveHour: CostUsageWindow | null;
  sevenDay: CostUsageWindow | null;
  // 'oauth' = live numbers, 'unauthorized' = token expired (relog required),
  // 'unavailable' = creds missing or endpoint down.
  source: 'oauth' | 'unauthorized' | 'unavailable';
}

export interface Workspace {
  id: string;
  name: string;
  currentFolderId: string;
}

export interface WorkspaceFolderPayload {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  defaultBranch: string;
  addedAt: string;
  current: boolean;
}

export type DiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'other';

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  patch: string;
}

export interface DiffPayload {
  base: string;
  branch: string | null;
  files: DiffFile[];
  empty: boolean;
}

export interface PendingDecisionPayload {
  cardId: number;
  runId: number;
  issueNumber: number;
  question: string;
  options: Array<{ value: string; label: string }>;
  createdAt: string;
}

export interface PreviewStatePayload {
  url: string | null;
  state: PreviewState;
  pid: number | null;
}

export interface UploadAttachmentResult {
  filename: string;
  absolutePath: string;
  relativePath: string;
  size: number;
  contentType: string;
}

export type AgentRunEventPayload =
  | { subscriptionId: string; kind: 'event'; event: AgentEvent }
  | { subscriptionId: string; kind: 'card'; card: Card }
  | { subscriptionId: string; kind: 'status'; status: AgentRunStatus }
  | { subscriptionId: string; kind: 'end' };

export interface BridgeChannels {
  'config:get': { args: void; result: Config };
  'issues:list': {
    args: { state?: 'open' | 'closed' | 'all' };
    result: DecoratedIssue[];
  };
  'issues:list-archived': { args: void; result: DecoratedIssue[] };
  'issues:get': { args: { number: number }; result: IssueDetail };
  'issues:create': { args: CreateIssueInput; result: DecoratedIssue };
  'issues:patch': {
    args: { number: number; patch: UpdateIssuePatch };
    result: DecoratedIssue;
  };
  'issues:add-comment': {
    args: { number: number; body: string };
    result: Comment;
  };
  'issues:post-message': {
    args: {
      number: number;
      body: string;
      dispatch?: boolean;
      model?: string;
      appendSystemPrompt?: string;
    };
    result: PostMessageResult;
  };
  'issues:list-runs': { args: { number: number }; result: AgentRun[] };
  'issues:dispatch': {
    args: { number: number; fromStatus: StatusKey | null; model?: string };
    result: DispatchResult;
  };
  'issues:start-agent': {
    args: {
      number: number;
      threadId: number;
      prompt: string;
      appendSystemPrompt?: string;
      model?: string;
    };
    result: AgentRun;
  };
  'issues:archive': { args: { number: number }; result: DecoratedIssue };
  'issues:unarchive': { args: { number: number }; result: DecoratedIssue };
  'issues:approve': { args: { number: number }; result: DecoratedIssue };
  'issues:request-changes': { args: { number: number }; result: DecoratedIssue };
  'issues:split': {
    args: {
      number: number;
      subtasks: Array<{ title: string; body?: string }>;
      dispatch?: boolean;
    };
    result: SplitResult;
  };
  'issues:reviewer': {
    args: { number: number; threadId?: number; prompt?: string; model?: string };
    result: AgentRun;
  };
  'agent-runs:get': { args: { runId: number }; result: AgentRun };
  'agent-runs:stop': { args: { runId: number }; result: AgentRun };
  'agent-runs:diff': { args: { runId: number }; result: DiffPayload };
  'agent-runs:stats': { args: { runId: number }; result: RunStatsResult };
  'agent-runs:checks:list': { args: { runId: number }; result: AgentCheck[] };
  'agent-runs:checks:run': {
    args: { runId: number; kinds?: CheckKind[] };
    result: AgentCheck[];
  };
  'agent-runs:preview:get': {
    args: { runId: number };
    result: PreviewStatePayload;
  };
  'agent-runs:preview:start': {
    args: { runId: number };
    result: PreviewStatePayload;
  };
  'agent-runs:preview:stop': {
    args: { runId: number };
    result: PreviewStatePayload;
  };
  'agent-runs:fork': { args: { runId: number }; result: ForkRunResult };
  'agent-runs:promote-commit': {
    args: { runId: number };
    result: PromoteCommitResult;
  };
  'agent-runs:promote-pr': {
    args: { runId: number };
    result: PromotePrResult;
  };
  'agent-runs:events:subscribe': {
    args: { runId: number; sinceSeq?: number };
    result: EventSubscribeResult;
  };
  'agent-runs:events:unsubscribe': {
    args: { subscriptionId: string };
    result: void;
  };
  'cards:resolve': {
    args: { cardId: number; value: string };
    result: ResolveCardResult;
  };
  'cards:dismiss': {
    args: { cardId: number };
    result: DismissCardResult;
  };
  'decisions:pending': { args: void; result: PendingDecisionPayload[] };
  'cost:today': { args: void; result: CostTodayResult };
  'cost:usage': { args: void; result: CostUsageResult };
  'workspace:get': { args: void; result: Workspace };
  'folders:list': { args: void; result: WorkspaceFolderPayload[] };
  'folders:add': {
    args: { name: string; path: string; defaultBranch?: string };
    result: WorkspaceFolderPayload;
  };
  'composer:draft': { args: { description: string }; result: DraftedIssue };
  'composer:suggest': { args: { personaPrompt: string }; result: DraftedIssue };
  'attachments:upload': {
    args: { contentType: string; data: Uint8Array };
    result: UploadAttachmentResult;
  };
  'autopilot:start': {
    args: {
      kind: AutopilotKind;
      title?: string;
      config: AutopilotConfig;
    };
    result: { sessionId: number; issueNumber: number };
  };
  'autopilot:stop': {
    args: { sessionId: number; stopChildren: boolean };
    result: { sessionId: number };
  };
  'autopilot:list-active': { args: void; result: AutopilotSession[] };
  'autopilot:get-by-issue': {
    args: { issueNumber: number };
    result: AutopilotSession | null;
  };
  'sentry:get-config': { args: void; result: SentryConfigPayload };
  'sentry:save-config': {
    args: SentryConfigInput;
    result: SentryConfigPayload;
  };
  'sentry:test-connection': {
    args: { token?: string; orgSlug?: string; projectSlug?: string };
    result: SentryTestConnectionResult;
  };
  'sentry:sync-now': { args: void; result: SentrySyncResult };
  'sentry:analyze': {
    args: { issueNumber: number };
    result: SentrySuggestion;
  };
  'sentry:apply-suggestion': {
    args: { issueNumber: number };
    result: DecoratedIssue;
  };
}

export type ChannelName = keyof BridgeChannels;
export type ChannelArgs<C extends ChannelName> = BridgeChannels[C]['args'];
export type ChannelResult<C extends ChannelName> = BridgeChannels[C]['result'];
