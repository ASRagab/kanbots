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
} from './composer.js';

export { parseStreamLine, makeLineSplitter, type StreamEvent } from './stream-parser.js';

export {
  startAgentRun,
  type AgentRunHandle,
  type RunResult,
  type RunSummary,
  type StartAgentRunOptions,
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
  defaultCheckCommand,
  runCheck,
  type CheckCommand,
  type CheckResult,
  type RunCheckOptions,
} from './checks.js';

export {
  startPreview,
  type PreviewHandle,
  type StartPreviewOptions,
  type PreviewState as DispatcherPreviewState,
} from './preview.js';
