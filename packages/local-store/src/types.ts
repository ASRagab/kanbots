export type ThreadId = number;
export type ChatConversationId = number;
export type MessageId = number;
export type CardId = number;
export type AgentRunId = number;
export type AgentEventId = number;
export type PromotionId = number;

export type Role = 'user' | 'agent' | 'system';

export type CardType = 'decision' | 'proposed_diff' | 'confirmation' | 'pick_files' | 'result';
export type CardStatus = 'pending' | 'resolved' | 'dismissed';

export type AgentRunStatus =
  | 'starting'
  | 'running'
  | 'awaiting_input'
  | 'complete'
  | 'failed'
  | 'stopped';

/**
 * Terminal-quality classification of a run, used by analytics and the
 * memory-ledger curator. Higher signals overwrite lower ones monotonically
 * (a `completed_clean` run becomes `promoted` if/when the user lands its
 * commit; never the reverse).
 *
 * - `pending` — run is in flight or initial state (default for new rows)
 * - `failed` — exit code != 0 or result.isError
 * - `stopped` — user-initiated stop, no budget exhaustion
 * - `aborted_budget` — stopped because per-run cost cap hit
 * - `completed_with_failed_checks` — finished successfully but a check failed
 * - `completed_clean` — finished successfully, no failed checks
 * - `promoted` — code from this run was merged via promoteCommit / PR
 */
export type SuccessSignal =
  | 'pending'
  | 'failed'
  | 'stopped'
  | 'aborted_budget'
  | 'completed_with_failed_checks'
  | 'completed_clean'
  | 'promoted';

/** Ordered such that a higher signal cannot regress to a lower one. Used
 *  by promotion and check-failure paths to know when to upgrade. */
const SUCCESS_SIGNAL_RANK: Record<SuccessSignal, number> = {
  pending: 0,
  failed: 1,
  stopped: 1,
  aborted_budget: 1,
  completed_with_failed_checks: 2,
  completed_clean: 3,
  promoted: 4,
};

/** True if `next` is a valid forward transition from `prev` (monotonic). */
export function canUpgradeSuccessSignal(
  prev: SuccessSignal | null,
  next: SuccessSignal,
): boolean {
  if (prev === null) return true;
  return SUCCESS_SIGNAL_RANK[next] > SUCCESS_SIGNAL_RANK[prev];
}

export type AgentEventType =
  | 'tool_use'
  | 'tool_result'
  | 'text'
  | 'error'
  | 'containment_warning';

export type PromotionKind = 'comment' | 'pull_request';

export interface Thread {
  id: ThreadId;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  createdAt: string;
  lastProvider: string | null;
  lastModel: string | null;
}

export interface ChatConversation {
  id: ChatConversationId;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  threadId: ThreadId;
}

export interface Message {
  id: MessageId;
  threadId: ThreadId;
  role: Role;
  body: string;
  createdAt: string;
  agentRunId: AgentRunId | null;
  promotedGithubCommentId: number | null;
  promotedAt: string | null;
}

export interface Card<P = unknown> {
  id: CardId;
  messageId: MessageId;
  type: CardType;
  payload: P;
  status: CardStatus;
  resolvedValue: unknown;
  resolvedAt: string | null;
}

export type CheckKind = 'typecheck' | 'tests' | 'lint' | 'e2e';
export type CheckStatus = 'idle' | 'running' | 'pass' | 'fail';
export type PreviewState = 'idle' | 'booting' | 'live' | 'crashed' | 'stopped';

export interface AgentRun {
  id: AgentRunId;
  threadId: ThreadId;
  worktreePath: string | null;
  branchName: string | null;
  pid: number | null;
  status: AgentRunStatus;
  startedAt: string;
  endedAt: string | null;
  tokenUsageInput: number | null;
  tokenUsageOutput: number | null;
  exitReason: string | null;
  stopEscalation: 'sigterm' | 'sigkill' | null;
  sessionId: string | null;
  model: string | null;
  provider: string | null;
  totalCostUsd: number | null;
  costBudgetUsd: number | null;
  durationMs: number | null;
  previewUrl: string | null;
  previewState: PreviewState | null;
  previewPid: number | null;
  /** Persona id when dispatched via autopilot; null otherwise. */
  personaId: string | null;
  /** Coarse classification derived from issue labels (e.g. `feat`, `bug`). */
  cardKind: string | null;
  /** Bucketed body-length proxy used as a card-size feature for analytics. */
  cardSizeBucket: string | null;
  /** Raw issue body length captured at dispatch — kept so card_size_bucket
   *  can be re-computed if thresholds change. */
  issueBodyChars: number | null;
  /** Terminal classification of the run, used by analytics and curator. */
  successSignal: SuccessSignal | null;
}

export interface AgentCheck {
  id: number;
  agentRunId: AgentRunId;
  kind: CheckKind;
  status: CheckStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
}

export interface AgentEvent {
  id: AgentEventId;
  agentRunId: AgentRunId;
  seq: number;
  type: AgentEventType;
  payload: unknown;
  createdAt: string;
}

export interface Promotion {
  id: PromotionId;
  cardId: CardId | null;
  messageId: MessageId | null;
  kind: PromotionKind;
  githubId: number;
  createdAt: string;
}

export interface CacheEntry {
  key: string;
  etag: string | null;
  lastModified: string | null;
  body: string;
  updatedAt: string;
}

export type AutopilotKind = 'feature-dev' | 'qa';
export type AutopilotStatus = 'running' | 'stopped' | 'completed' | 'failed';
export type AutopilotChildKind = 'feat' | 'bug';
export type AutopilotChildStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'complete'
  | 'failed'
  | 'stopped'
  | 'skipped';

export interface AutopilotPersonaSnapshot {
  id: string;
  name: string;
  prompt: string;
}

export interface AutopilotCheckCommand {
  kind: 'typecheck' | 'tests' | 'lint' | 'build' | 'e2e';
  command: string;
  args: string[];
}

export type AutopilotEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AutopilotConfig =
  | {
      kind: 'feature-dev';
      personas: AutopilotPersonaSnapshot[];
      model?: string;
      provider?: ProviderId;
      effort?: AutopilotEffort;
      parallelism?: number;
      sessionCostBudgetUsd?: number;
    }
  | {
      kind: 'qa';
      checks: AutopilotCheckCommand[];
      liveUi: boolean;
      devServer?: { command: string; args: string[] };
      sessionCostBudgetUsd?: number;
    };

export interface AutopilotChildEntry {
  issueNumber: number;
  runId: number | null;
  kind: AutopilotChildKind;
  status: AutopilotChildStatus;
  createdAt: string;
  endedAt: string | null;
  persona?: string;
  title: string;
  note?: string;
}

export interface AutopilotPlanningEvent {
  kind: 'tool' | 'thought';
  text: string;
  at: string;
}

export interface AutopilotPlanningSlot {
  slotIndex: number;
  persona: string;
  startedAt: string;
  recentEvents: AutopilotPlanningEvent[];
}

export interface AutopilotSession {
  id: number;
  issueNumber: number;
  kind: AutopilotKind;
  config: AutopilotConfig;
  status: AutopilotStatus;
  startedAt: string;
  endedAt: string | null;
  stopReason: string | null;
  cycleIndex: number;
  currentChildRunId: number | null;
  children: AutopilotChildEntry[];
  /** Ephemeral, not persisted: per-slot live planner activity while
   * suggestIssue is in flight. Cleared once a child task is appended. */
  planningSlots?: AutopilotPlanningSlot[];
}

export type ProviderId = 'claude-code' | 'codex-cli';
export type ProviderKeyEncryption = 'safe' | 'plain';

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  defaultModel: string | null;
  keyEncrypted: Buffer | null;
  keyEncryption: ProviderKeyEncryption;
  lastValidatedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderSettings {
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
  envMigrationDone: boolean;
}

export type SentryTokenEncryption = 'safe' | 'plain';

export interface SentryConfig {
  enabled: boolean;
  orgSlug: string | null;
  projectSlug: string | null;
  tokenEncrypted: Buffer | null;
  tokenEncryption: SentryTokenEncryption;
  pollIntervalSeconds: number;
  environmentFilter: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  consecutiveAuthFailures: number;
}

export type SentryImportStatus = 'imported' | 'analyzed' | 'applied' | 'upstream_resolved';

export type SentrySuggestionVerdict = 'task' | 'skip';
export type SentrySuggestionConfidence = 'high' | 'medium' | 'low';
export type SentrySuggestionCategory = 'bug' | 'config' | 'flake' | 'noise';

export interface SentrySuggestion {
  verdict: SentrySuggestionVerdict;
  confidence: SentrySuggestionConfidence;
  category: SentrySuggestionCategory;
  reasoning: string;
  suggestedTitle: string;
  suggestedBody: string;
}

export interface SentryImport {
  sentryIssueId: string;
  localIssueNumber: number;
  status: SentryImportStatus;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastEventId: string | null;
  permalink: string | null;
  culprit: string | null;
  errorType: string | null;
  errorValue: string | null;
  analyzedAt: string | null;
  suggestion: SentrySuggestion | null;
}
