import type { Config } from '../../src/handlers/types.js';
import {
  createHandlers,
  type Handlers,
  type SubscriptionRegistry,
} from '../../src/index.js';
import { FakeIssueSource, makeStubSupervisor } from './fakes.js';
import { openStoreInMemory, type Store } from '@kanbots/local-store';

export interface FakeRegistry extends SubscriptionRegistry {
  calls: Array<{ kind: 'register' | 'unregister'; args: unknown }>;
  next: { subscriptionId: string; runStatus: 'starting' | 'running' | 'awaiting_input' | 'complete' | 'failed' | 'stopped' };
}

export function makeFakeRegistry(): FakeRegistry {
  const calls: FakeRegistry['calls'] = [];
  const reg: FakeRegistry = {
    calls,
    next: { subscriptionId: 'sub-test', runStatus: 'running' },
    register(args) {
      calls.push({ kind: 'register', args });
      return reg.next;
    },
    unregister(subscriptionId) {
      calls.push({ kind: 'unregister', args: { subscriptionId } });
    },
  };
  return reg;
}

export interface HandlerTestKit {
  source: FakeIssueSource;
  store: Store;
  supervisor: ReturnType<typeof makeStubSupervisor>;
  registry: FakeRegistry;
  config: Config;
  handlers: Handlers;
  draftIssue: (input: { description: string }) => Promise<{ title: string; body: string }>;
}

export function makeHandlerTestKit(
  configOverride: Partial<Config> = {},
): HandlerTestKit {
  const source = new FakeIssueSource();
  const store = openStoreInMemory();
  const supervisor = makeStubSupervisor(store);
  const registry = makeFakeRegistry();
  const draftIssue = async (input: { description: string }) => ({
    title: `drafted: ${input.description.slice(0, 40)}`,
    body: `# Drafted\n\n${input.description}`,
  });
  const config: Config = { owner: 'octo', repo: 'hello', ...configOverride };
  const handlers = createHandlers({
    deps: { source, store, config, supervisor, draftIssue },
    subscriptions: registry,
  });
  return { source, store, supervisor, registry, config, handlers, draftIssue };
}
