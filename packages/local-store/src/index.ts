import { openDb, type Db } from './db.js';
import { migrations } from './migrations/index.js';
import { runMigrations } from './migrations/runner.js';
import { AgentChecksRepo } from './repos/agent-checks.js';
import { AgentEventsRepo } from './repos/agent-events.js';
import { AgentRunsRepo } from './repos/agent-runs.js';
import { AutopilotSessionsRepo } from './repos/autopilot-sessions.js';
import { CardsRepo } from './repos/cards.js';
import { FoldersRepo } from './repos/folders.js';
import { HttpCacheRepo } from './repos/http-cache.js';
import { LocalIssuesRepo } from './repos/local-issues.js';
import { MessagesRepo } from './repos/messages.js';
import { PromotionsRepo } from './repos/promotions.js';
import { SentryConfigRepo } from './repos/sentry-config.js';
import { SentryImportsRepo } from './repos/sentry-imports.js';
import { ThreadsRepo } from './repos/threads.js';
import { WorkspacesRepo } from './repos/workspaces.js';

export interface Store {
  readonly threads: ThreadsRepo;
  readonly messages: MessagesRepo;
  readonly cards: CardsRepo;
  readonly agentRuns: AgentRunsRepo;
  readonly events: AgentEventsRepo;
  readonly checks: AgentChecksRepo;
  readonly promotions: PromotionsRepo;
  readonly httpCache: HttpCacheRepo;
  readonly localIssues: LocalIssuesRepo;
  readonly workspaces: WorkspacesRepo;
  readonly folders: FoldersRepo;
  readonly autopilotSessions: AutopilotSessionsRepo;
  readonly sentryConfig: SentryConfigRepo;
  readonly sentryImports: SentryImportsRepo;
  readonly db: Db;
  close(): void;
}

export interface OpenStoreOptions {
  path: string;
}

export function openStore(opts: OpenStoreOptions): Store {
  const db = openDb(opts.path);
  runMigrations(db, migrations);
  return wrap(db);
}

export function openStoreInMemory(): Store {
  return openStore({ path: ':memory:' });
}

function wrap(db: Db): Store {
  return {
    threads: new ThreadsRepo(db),
    messages: new MessagesRepo(db),
    cards: new CardsRepo(db),
    agentRuns: new AgentRunsRepo(db),
    events: new AgentEventsRepo(db),
    checks: new AgentChecksRepo(db),
    promotions: new PromotionsRepo(db),
    httpCache: new HttpCacheRepo(db),
    localIssues: new LocalIssuesRepo(db),
    workspaces: new WorkspacesRepo(db),
    folders: new FoldersRepo(db),
    autopilotSessions: new AutopilotSessionsRepo(db),
    sentryConfig: new SentryConfigRepo(db),
    sentryImports: new SentryImportsRepo(db),
    db,
    close: () => db.close(),
  };
}

export const PACKAGE_NAME = '@kanbots/local-store';

export type { Db } from './db.js';
export { migrations, runMigrations };
export type { Migration } from './migrations/types.js';

export { CardAlreadyResolvedError } from './repos/cards.js';
export type { CreateCardInput } from './repos/cards.js';
export type { CreateThreadInput } from './repos/threads.js';
export type { CreateMessageInput } from './repos/messages.js';
export type { CreateAgentRunInput, UpdateAgentRunPatch } from './repos/agent-runs.js';
export type {
  CreateAutopilotSessionInput,
  UpdateAutopilotSessionPatch,
} from './repos/autopilot-sessions.js';
export type { AppendAgentEventInput, ListAgentEventsOptions } from './repos/agent-events.js';
export type { CreatePromotionInput } from './repos/promotions.js';
export type { SetCacheInput } from './repos/http-cache.js';

export {
  LocalIssueNotFoundError,
  type CreateLocalCommentInput,
  type CreateLocalIssueInput,
  type UpdateLocalIssuePatch,
} from './repos/local-issues.js';
export { LocalIssueSource, type LocalIssueSourceOptions } from './local-issue-source.js';

export type { SentryConfigPatch } from './repos/sentry-config.js';
export type { UpsertSentryImportInput } from './repos/sentry-imports.js';

export type { Workspace, CreateWorkspaceInput } from './repos/workspaces.js';
export type { Folder, CreateFolderInput } from './repos/folders.js';

export {
  describeKanbotsDir,
  ensureGitignoreEntry,
  ensureKanbotsDir,
  findGitRoot,
  readWorkspaceConfig,
  resolveGitUserName,
  writeWorkspaceConfig,
  type GitHubWorkspaceConfig,
  type KanbotsDir,
  type LocalWorkspaceConfig,
  type WorkspaceConfig,
  type WorkspaceMode,
} from './workspace.js';

export type {
  AgentCheck,
  AgentEvent,
  AgentEventId,
  AgentEventType,
  AgentRun,
  AgentRunId,
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
  CacheEntry,
  Card,
  CardId,
  CardStatus,
  CardType,
  CheckKind,
  CheckStatus,
  Message,
  MessageId,
  PreviewState,
  Promotion,
  PromotionId,
  PromotionKind,
  Role,
  SentryConfig,
  SentryImport,
  SentryImportStatus,
  SentrySuggestion,
  SentrySuggestionCategory,
  SentrySuggestionConfidence,
  SentrySuggestionVerdict,
  SentryTokenEncryption,
  Thread,
  ThreadId,
} from './types.js';

export type { StartCheckInput, FinishCheckInput } from './repos/agent-checks.js';
