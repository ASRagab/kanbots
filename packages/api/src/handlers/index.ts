import type {
  BridgeChannels,
  ChannelArgs,
  ChannelName,
  ChannelResult,
} from '../bridge.js';
import * as agentActions from './agent-actions.js';
import * as agentChecks from './agent-checks.js';
import * as agentEvents from './agent-events.js';
import * as agentPreview from './agent-preview.js';
import * as agentRuns from './agent-runs.js';
import * as attachments from './attachments.js';
import * as autopilot from './autopilot.js';
import * as cards from './cards.js';
import * as composer from './composer.js';
import * as config from './config.js';
import * as cooldown from './cooldown.js';
import * as cost from './cost.js';
import * as decisions from './decisions.js';
import * as issues from './issues.js';
import * as sentry from './sentry.js';
import type {
  CreateHandlersOptions,
  HandlerDeps,
  SentryRuntime,
  SubscriptionRegistry,
} from './types.js';
import * as workspace from './workspace.js';

export type { CreateHandlersOptions, HandlerDeps, SentryRuntime, SubscriptionRegistry };
export type {
  Config,
  DraftIssueFn,
  SentryAnalyzerFn,
  SuggestFeatureFn,
} from './types.js';
export type { RunCheckImpl } from './agent-checks.js';
export type { StartPreviewImpl } from './agent-preview.js';

export type Handlers = {
  [C in ChannelName]: (
    args: ChannelArgs<C>,
  ) => Promise<ChannelResult<C>>;
};

export type { BridgeChannels, ChannelArgs, ChannelName, ChannelResult };

export function createHandlers(opts: CreateHandlersOptions): Handlers {
  const { deps } = opts;
  const map: Handlers = {
    'config:get': () => config.getConfig(deps),
    'issues:list': (args) => issues.list(deps, args),
    'issues:list-archived': () => issues.listArchived(deps),
    'issues:get': (args) => issues.get(deps, args),
    'issues:create': (args) => issues.create(deps, args),
    'issues:patch': (args) => issues.patch(deps, args),
    'issues:add-comment': (args) => issues.addComment(deps, args),
    'issues:post-message': (args) => issues.postMessage(deps, args),
    'issues:list-runs': (args) => issues.listRuns(deps, args),
    'issues:dispatch': (args) => issues.dispatch(deps, args),
    'issues:start-agent': (args) => agentActions.startAgent(deps, args),
    'issues:archive': (args) => agentActions.archive(deps, args),
    'issues:unarchive': (args) => agentActions.unarchive(deps, args),
    'issues:approve': (args) => agentActions.approve(deps, args),
    'issues:request-changes': (args) => agentActions.requestChanges(deps, args),
    'issues:split': (args) => agentActions.split(deps, args),
    'issues:reviewer': (args) => agentActions.reviewer(deps, args),
    'agent-runs:get': (args) => agentRuns.get(deps, args),
    'agent-runs:stop': (args) => agentRuns.stop(deps, args),
    'agent-runs:diff': (args) => agentRuns.diff(deps, args),
    'agent-runs:stats': (args) => agentRuns.stats(deps, args),
    'agent-runs:reveal-worktree': (args) => agentRuns.revealWorktree(deps, args),
    'agent-runs:checks:list': (args) => agentChecks.list(deps, args),
    'agent-runs:checks:run': (args) => agentChecks.runChecks(deps, args),
    'agent-runs:checks:commands': () => agentChecks.commands(deps),
    'agent-runs:preview:get': (args) => agentPreview.getPreview(deps, args),
    'agent-runs:preview:start': (args) =>
      agentPreview.startRunPreview(deps, args),
    'agent-runs:preview:stop': (args) => agentPreview.stopRunPreview(deps, args),
    'agent-runs:fork': (args) => agentRuns.fork(deps, args),
    'agent-runs:promote-commit': (args) => agentRuns.promoteCommit(deps, args),
    'agent-runs:promote-pr': (args) => agentRuns.promotePr(deps, args),
    'agent-runs:events:subscribe': (args) => agentEvents.subscribe(opts, args),
    'agent-runs:events:unsubscribe': (args) =>
      agentEvents.unsubscribe(opts, args),
    'cards:resolve': (args) => cards.resolve(deps, args),
    'cards:dismiss': (args) => cards.dismiss(deps, args),
    'decisions:pending': () => decisions.pending(deps),
    'cost:today': () => cost.today(deps),
    'cost:usage': () => cost.usage(deps),
    'cooldown:get': () => cooldown.get(deps),
    'workspace:get': () => workspace.getWorkspace(deps),
    'workspace:get-budgets': () => workspace.getBudgets(deps),
    'workspace:set-budgets': (args) => workspace.setBudgets(deps, args),
    'folders:list': () => workspace.listFolders(deps),
    'folders:add': (args) => workspace.addFolder(deps, args),
    'composer:draft': (args) => composer.draft(deps, args),
    'composer:suggest': (args) => composer.suggest(deps, args),
    'attachments:upload': (args) => attachments.upload(deps, args),
    'autopilot:start': (args) => autopilot.start(deps, args),
    'autopilot:stop': (args) => autopilot.stop(deps, args),
    'autopilot:list-active': () => autopilot.listActive(deps),
    'autopilot:get-by-issue': (args) => autopilot.getByIssue(deps, args),
    'sentry:get-config': () => sentry.getConfig(deps),
    'sentry:save-config': (args) => sentry.saveConfig(deps, args),
    'sentry:test-connection': (args) => sentry.testConnection(deps, args),
    'sentry:sync-now': () => sentry.syncNow(deps),
    'sentry:analyze': (args) => sentry.analyze(deps, args),
    'sentry:apply-suggestion': (args) => sentry.applySuggestion(deps, args),
  };
  return map;
}
