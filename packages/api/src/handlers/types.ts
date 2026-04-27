import type { IssueSource } from '@kanbots/core';
import type { Store } from '@kanbots/local-store';
import type { AgentSupervisor } from '../agent-runs/supervisor.js';
import type {
  Config,
  DraftIssueFn,
  EventSubscribeResult,
} from '../bridge.js';

export type { Config, DraftIssueFn, EventSubscribeResult };

export interface HandlerDeps {
  source: IssueSource;
  store: Store;
  config: Config;
  supervisor: AgentSupervisor;
  draftIssue: DraftIssueFn;
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
