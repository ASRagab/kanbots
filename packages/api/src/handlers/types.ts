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

export interface WorkspaceBudgetsAccessor {
  get(): { runCostBudgetUsd: number | null; sessionCostBudgetUsd: number | null };
  set(input: {
    runCostBudgetUsd: number | null;
    sessionCostBudgetUsd: number | null;
  }): Promise<void> | void;
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
  budgets?: WorkspaceBudgetsAccessor;
  revealPath?: (path: string) => Promise<void>;
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
