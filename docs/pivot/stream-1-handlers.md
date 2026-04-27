# Stream 1 — Pure handlers + bridge contract

> Read `docs/pivot/README.md` first. The contract there is binding.

## Mission

Convert every Express route body in `packages/api/src/routes/` into a pure
handler function in `packages/api/src/handlers/`, keyed by the channel
names from the contract. Define and export the `BridgeChannels` type map
that the IPC bridge and the renderer will both consume.

You do **not** delete the Express routes. They keep working during the
coexistence period — Stream 4 deletes them once everyone has migrated.

## Branch

```sh
git checkout -b pivot/01-handlers
```

## Files you own

- `packages/api/src/bridge.ts` — **NEW.** The `BridgeChannels` type map and
  any shared payload types referenced by the contract.
- `packages/api/src/handlers/` — **NEW directory.** One file per resource
  group, mirroring `routes/` (`issues.ts`, `agent-runs.ts`, `cards.ts`,
  `composer.ts`, `decisions.ts`, `workspace.ts`, `attachments.ts`,
  `cost.ts`, `agent-checks.ts`, `agent-preview.ts`, `agent-actions.ts`).
- `packages/api/src/handlers/index.ts` — **NEW.** Aggregates every
  handler into a single typed `Handlers` object.
- `packages/api/src/index.ts` — **MODIFY (additive).** Re-export
  `BridgeChannels`, the `Handlers` type, and a `createHandlers(deps)`
  factory.
- `packages/api/tests/handlers/` — **NEW.** Vitest specs for each handler
  module.

## Files you must NOT touch

- `packages/api/src/routes/**` — Stream 4 deletes these.
- `packages/api/src/app.ts` — Stream 4 deletes this.
- `packages/api/src/middleware/**` — Stream 4 deletes these.
- Anything under `packages/desktop/` or `packages/web/`.
- Existing `packages/api/tests/*-create.test.ts` etc. (the supertest
  ones) — they keep working until Stream 4 removes them.

## Work

### 1. Define the contract — `packages/api/src/bridge.ts`

```ts
import type {
  AgentRun,
  AgentRunStatus,
  AgentCheck,
  AgentEvent,
  Card,
  CheckKind,
  Message,
  PreviewState,
} from '@kanbots/local-store';
import type {
  Comment,
  CreateIssueInput,
  Issue,
  StatusKey,
  UpdateIssuePatch,
} from '@kanbots/core';

// Re-export shared types the renderer also needs.
export type {
  AgentRun,
  AgentRunStatus,
  AgentCheck,
  AgentEvent,
  Card,
  CheckKind,
  Message,
  PreviewState,
  Comment,
  CreateIssueInput,
  Issue,
  StatusKey,
  UpdateIssuePatch,
};

export interface BridgeChannels {
  'config:get': { args: void; result: Config };
  'issues:list': {
    args: { state?: 'open' | 'closed' | 'all' };
    result: DecoratedIssue[];
  };
  // …one entry per row in the contract table…
  'agent-runs:events:subscribe': {
    args: { runId: number; sinceSeq?: number };
    result: { subscriptionId: string; runStatus: AgentRunStatus };
  };
  'agent-runs:events:unsubscribe': {
    args: { subscriptionId: string };
    result: void;
  };
}

export type AgentRunEventPayload =
  | { subscriptionId: string; kind: 'event'; event: AgentEvent }
  | { subscriptionId: string; kind: 'card'; card: Card }
  | { subscriptionId: string; kind: 'status'; status: AgentRunStatus }
  | { subscriptionId: string; kind: 'end' };

export type ChannelName = keyof BridgeChannels;
export type ChannelArgs<C extends ChannelName> = BridgeChannels[C]['args'];
export type ChannelResult<C extends ChannelName> = BridgeChannels[C]['result'];
```

Use the contract table in `docs/pivot/README.md` as the spec — every row is
one entry in `BridgeChannels`. If a payload uses a server-side type that
isn't already in `@kanbots/core` or `@kanbots/local-store`, define it here
and re-export.

### 2. Extract handlers — `packages/api/src/handlers/`

For each existing route, lift the route handler body into a pure function
of the form:

```ts
async function handler(deps: HandlerDeps, args: ArgsT): Promise<ResultT> {
  // identical body to the existing route, minus req/res plumbing
}
```

Where `HandlerDeps` is:

```ts
export interface HandlerDeps {
  source: IssueSource;
  store: Store;
  config: ConfigPayload;
  supervisor: AgentSupervisor;
  draftIssue: DraftIssueFn;
}
```

(Same shape as the current `AppDeps`, since every route already accepts
some subset of these.)

Group one file per resource:

```
handlers/
├── index.ts              # createHandlers(deps): Handlers
├── config.ts             # config:get
├── issues.ts             # issues:list, issues:get, issues:create, issues:patch,
│                         # issues:add-comment, issues:post-message,
│                         # issues:list-runs, issues:dispatch
├── agent-runs.ts         # agent-runs:get, agent-runs:stop, agent-runs:diff,
│                         # agent-runs:stats, agent-runs:fork
├── agent-actions.ts      # issues:start-agent, issues:archive, issues:approve,
│                         # issues:request-changes, issues:split, issues:reviewer
├── agent-checks.ts       # agent-runs:checks:list, agent-runs:checks:run
├── agent-preview.ts      # agent-runs:preview:get/start/stop
├── agent-events.ts       # agent-runs:events:subscribe/unsubscribe
├── cards.ts              # cards:resolve
├── decisions.ts          # decisions:pending
├── cost.ts               # cost:today
├── workspace.ts          # workspace:get, folders:list, folders:add
├── composer.ts           # composer:draft
└── attachments.ts        # attachments:upload
```

#### Translating Express → handler

- Drop `req`, `res`, `next`. Args come in directly.
- Replace `req.body`/`req.params`/`req.query` with the typed `args`.
  Validate with the same zod schema you find in the route, but throw the
  parse error instead of returning a 400.
- Replace `res.status(404).json(...)` with `throw Object.assign(new
  Error('not found'), { name: 'NotFound' })`. Stream 2 maps the `name`
  field back to a structured rejection on the renderer side.
- Replace `res.status(409).json(...)` similarly with `name: 'AlreadyActive'`
  (or whichever name the original route used in its body).
- For `issues:dispatch`, preserve the existing `409 + { run }` payload
  by attaching the run to the error: `Object.assign(new Error(...), {
  name: 'AlreadyActive', run })`. Document this in the handler.

#### The streaming handler — `agent-events.ts`

This is the only handler with non-trivial lifecycle. It does **not** push
events itself; it returns a subscription handle, and Stream 2 wires the
push side via `webContents.send`. The handler shape:

```ts
export interface SubscriptionRegistry {
  register(
    runId: number,
    sinceSeq: number | undefined,
    onEvent: (event: AgentEvent) => void,
    onCard: (card: Card) => void,
    onStatus: (status: AgentRunStatus) => void,
    onEnd: () => void,
  ): { subscriptionId: string; runStatus: AgentRunStatus };

  unregister(subscriptionId: string): void;
}
```

`createHandlers` accepts a `SubscriptionRegistry` from its caller (Stream 2
provides it). The `agent-runs:events:subscribe` handler:

1. Looks up the run from the store; throw `NotFound` if missing.
2. Calls `registry.register(...)`. The registry is responsible for
   replaying historical events, subscribing to live ones, and forwarding
   each event to the supplied callbacks.
3. Returns `{ subscriptionId, runStatus }`.

The handler does **not** know about `webContents`. The registry does. Keep
that boundary clean — it lets the handler be unit-tested with a fake
registry.

`agent-runs:events:unsubscribe` is one line: `registry.unregister(args.subscriptionId)`.

### 3. The aggregate factory — `handlers/index.ts`

```ts
export type Handlers = {
  [C in ChannelName]: (args: ChannelArgs<C>) => Promise<ChannelResult<C>>;
};

export interface CreateHandlersOptions {
  deps: HandlerDeps;
  subscriptions: SubscriptionRegistry;
}

export function createHandlers(opts: CreateHandlersOptions): Handlers {
  return {
    'config:get': (args) => configHandlers.get(opts.deps, args),
    'issues:list': (args) => issuesHandlers.list(opts.deps, args),
    // …
    'agent-runs:events:subscribe': (args) =>
      agentEventsHandlers.subscribe(opts, args),
    'agent-runs:events:unsubscribe': (args) =>
      agentEventsHandlers.unsubscribe(opts, args),
  };
}
```

Strict typing means missing channels won't compile. Good — that's the
point.

### 4. Update `packages/api/src/index.ts`

Add (don't remove):

```ts
export {
  createHandlers,
  type Handlers,
  type CreateHandlersOptions,
  type HandlerDeps,
  type SubscriptionRegistry,
} from './handlers/index.js';
export type {
  BridgeChannels,
  ChannelName,
  ChannelArgs,
  ChannelResult,
  AgentRunEventPayload,
} from './bridge.js';
```

Leave the existing `createApp` / `startServer` exports alone — Stream 4
removes them.

### 5. Tests — `packages/api/tests/handlers/`

For each handler module, write a vitest spec:

- Use `openStoreInMemory()` and a `FakeIssueSource` (already in
  `packages/api/tests/helpers/make-app.ts` — extract or duplicate as
  needed).
- Use the existing `makeStubSupervisor(store)` helper.
- For the subscription handler, write a fake `SubscriptionRegistry` that
  records calls and returns predictable subscription IDs.
- Aim to cover the same paths the existing route tests cover. The
  existing tests stay green — they go through Express — so use them as
  reference behavior.

You don't have to migrate the existing tests; Stream 4 deletes them along
with Express.

## Definition of done

- [ ] `packages/api/src/bridge.ts` exports `BridgeChannels` covering every
      row in the contract table.
- [ ] `packages/api/src/handlers/index.ts` exports `createHandlers` that
      returns a `Handlers` object satisfying the `BridgeChannels` map.
- [ ] Every handler has at least one passing vitest test.
- [ ] `pnpm --filter '@kanbots/api' typecheck` is green.
- [ ] `pnpm --filter '@kanbots/api' test` is green (your new tests pass;
      the existing route tests also still pass — you didn't change
      routes).
- [ ] `pnpm --filter '@kanbots/api' build` produces a `dist/` exporting
      the new symbols (verify by grepping `dist/index.d.ts` for
      `createHandlers` and `BridgeChannels`).

## Coordination

- Stream 2 imports your `Handlers`, `BridgeChannels`, and
  `SubscriptionRegistry` types. Pin the names early; if you change them
  mid-stream, post in the pivot thread.
- Stream 3 imports `BridgeChannels` for type-safe `invoke` calls.
- Stream 4 removes the routes you left intact.

## Sharp edges

- The `messages` route in `routes/issues.ts` has a `dispatch` flag that
  defaults to `true` and triggers an agent run. Preserve that exactly —
  don't refactor away the implicit dispatch unless you co-ordinate with
  the renderer (Stream 3 still relies on `dispatch: false` for the
  TaskCreate kickoff message).
- The `attachments` route accepts base64 today. The new
  `attachments:upload` channel takes a `Uint8Array`. Update the handler
  to accept either (write tests for both) and let Stream 3 switch the
  renderer to send raw bytes. Stream 4 removes the base64 path once the
  renderer no longer uses it.
- The fork route shells out to git via `execFile`. Its handler can stay
  identical; just lift it.
- The composer's `draftIssue` is injected as a function dep — keep that
  shape, don't bake any provider into the handler.

## Merge plan

1. Open PR `pivot/01-handlers` → `main`.
2. Stream 2's PR depends on this one merging first (they import your
   types). If your PR is in review, Stream 2 can rebase against your
   branch in the meantime.
3. The Express server is still alive after this PR merges. That's
   intended — coexistence period until Stream 4.
