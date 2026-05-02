import type { IssueSource } from '@kanbots/core';
import type { Store } from '@kanbots/local-store';
import type { AgentSupervisor } from '../agent-runs/supervisor.js';
import type { AutopilotManager } from '../autopilot/orchestrator.js';
import type {
  Config,
  DraftIssueFn,
  EventSubscribeResult,
  SentryAnalyzerFn,
  SuggestFeatureFn,
} from '../bridge.js';

export type {
  Config,
  DraftIssueFn,
  EventSubscribeResult,
  SentryAnalyzerFn,
  SuggestFeatureFn,
};

export interface SentryRuntime {
  encryptToken(plaintext: string): { buffer: Buffer; encryption: 'safe' | 'plain' };
  decryptToken(buffer: Buffer | null, encryption: 'safe' | 'plain'): string | null;
  envTokenOverride(): string | null;
  safeStorageAvailable(): boolean;
  syncNow(): Promise<{ imported: number; updated: number; totalSeen: number; lastSyncedAt: string }>;
  restartPoller(): void;
}

export interface ProvidersRuntime {
  encryptKey(plaintext: string): { buffer: Buffer; encryption: 'safe' | 'plain' };
  decryptKey(buffer: Buffer | null, encryption: 'safe' | 'plain'): string | null;
  safeStorageAvailable(): boolean;
  /** True if Claude Code CLI OAuth credentials are present on disk. */
  hasClaudeCodeCredentials(): boolean;
}

export interface ChatToolRuntime {
  /**
   * Returns the extra args + env vars to pass to `claude` so the chat
   * agent has the kanbots MCP server wired in. Implementations issue a
   * fresh per-run token and write the MCP config file.
   */
  prepareForRun(): Promise<{
    extraArgs: string[];
    env: Record<string, string>;
    /** Called once the run terminates so the token can be revoked. */
    cleanup: () => void;
  }>;
}

export interface WorkspaceBudgetsAccessor {
  get(): { runCostBudgetUsd: number | null; sessionCostBudgetUsd: number | null };
  set(input: {
    runCostBudgetUsd: number | null;
    sessionCostBudgetUsd: number | null;
  }): Promise<void> | void;
}

export interface WorkspaceHouseRulesAccessor {
  get(): { houseRules: string | null };
  set(input: { houseRules: string | null }): Promise<void> | void;
}

export interface HandlerDeps {
  source: IssueSource;
  store: Store;
  config: Config;
  supervisor: AgentSupervisor;
  draftIssue: DraftIssueFn;
  suggestIssue: SuggestFeatureFn;
  autopilot: AutopilotManager;
  analyzeSentryError: SentryAnalyzerFn;
  sentry: SentryRuntime;
  providers: ProvidersRuntime;
  budgets?: WorkspaceBudgetsAccessor;
  houseRules?: WorkspaceHouseRulesAccessor;
  revealPath?: (path: string) => Promise<void>;
  chatTools?: ChatToolRuntime;
}

export interface SubscriptionRegisterArgs {
  runId: number;
  sinceSeq?: number;
  /** Set by the IPC bridge to scope the subscription to a renderer window
   *  for cleanup on window destroy. Renderers don't (and can't) set it. */
  ownerId?: number;
}

export interface SubscriptionRegistry {
  register(args: SubscriptionRegisterArgs): EventSubscribeResult;
  unregister(subscriptionId: string): void;
}

export interface CreateHandlersOptions {
  deps: HandlerDeps;
  subscriptions: SubscriptionRegistry;
}
