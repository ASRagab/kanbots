export const PACKAGE_NAME = '@kanbots/dispatcher';

export {
  ComposerError,
  createComposer,
  createSuggester,
  type BacklogEntry,
  type CreateComposerOptions,
  type CreateSuggesterOptions,
  type DraftedIssue,
  type DraftIssueFn,
  type DraftIssueInput,
  type SpawnFn,
  type SuggestFeatureFn,
  type SuggestFeatureInput,
  type SuggestionEntryStatus,
} from './composer.js';

export {
  createSentryAnalyzer,
  type CreateSentryAnalyzerOptions,
  type SentryAnalyzerBreadcrumb,
  type SentryAnalyzerFn,
  type SentryAnalyzerInput,
  type SentryAnalyzerStackFrame,
  type SentryAnalyzerSuggestion,
} from './sentry-analyzer.js';

export { parseStreamLine, makeLineSplitter, type StreamEvent } from './stream-parser.js';

export {
  startAgentRun,
  DEFAULT_GRACEFUL_TIMEOUT_MS,
  type AgentRunHandle,
  type RunResult,
  type RunSummary,
  type StartAgentRunOptions,
  type StopOptions,
  type StopEscalation,
} from './worker.js';

export {
  createWorktree,
  removeWorktree,
  defaultWorktreePath,
  defaultBranchName,
  type CreateWorktreeInput,
  type RemoveWorktreeInput,
  type Worktree,
} from './worktree.js';

export {
  stampWorktreeIdentity,
  type StampWorktreeIdentityInput,
  type StampWorktreeIdentityResult,
} from './worktree-identity.js';

export {
  defaultCheckCommand,
  runCheck,
  type CheckCommand,
  type CheckResult,
  type RunCheckOptions,
} from './checks.js';

export {
  inspectToolUse,
  type ContainmentEscape,
  type InspectToolUseInput,
  type InspectToolUseResult,
} from './containment.js';

export {
  startPreview,
  type PreviewHandle,
  type StartPreviewOptions,
  type PreviewState as DispatcherPreviewState,
} from './preview.js';
