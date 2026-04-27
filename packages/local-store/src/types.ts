export type ThreadId = number;
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

export type AgentEventType = 'tool_use' | 'tool_result' | 'text' | 'error';

export type PromotionKind = 'comment' | 'pull_request';

export interface Thread {
  id: ThreadId;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  createdAt: string;
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
  sessionId: string | null;
  model: string | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  previewUrl: string | null;
  previewState: PreviewState | null;
  previewPid: number | null;
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

export type AutopilotConfig =
  | {
      kind: 'feature-dev';
      personas: AutopilotPersonaSnapshot[];
    }
  | {
      kind: 'qa';
      checks: AutopilotCheckCommand[];
      liveUi: boolean;
      devServer?: { command: string; args: string[] };
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
}
