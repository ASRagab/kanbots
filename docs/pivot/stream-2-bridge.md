# Stream 2 — Electron IPC bridge

> Read `docs/pivot/README.md` first. The contract there is binding.

## Mission

Wire up the IPC layer in `@kanbots/desktop` so the renderer can call every
handler from Stream 1 via `window.kanbots.invoke(channel, args)` and
subscribe to agent-run events via `window.kanbots.subscribe(eventName,
listener)`. Build the `SubscriptionRegistry` that backs the streaming
handler.

The Express server keeps running during the coexistence period. You add
IPC alongside it; Stream 4 deletes the server once the renderer no longer
needs it.

## Branch

```sh
git checkout -b pivot/02-bridge
```

## Files you own

- `packages/desktop/src/main.ts` — **MODIFY.** Register the new IPC
  handlers when a workspace opens; tear them down when it closes.
- `packages/desktop/src/preload.ts` — **MODIFY.** Add `invoke` and
  `subscribe` to the exposed `kanbots` object.
- `packages/desktop/src/types.ts` — **MODIFY.** Extend `KanbotsBridge` with
  the new methods.
- `packages/desktop/src/ipc/` — **NEW directory.**
  - `register.ts` — registers every channel in the `Handlers` map with
    `ipcMain.handle`.
  - `subscriptions.ts` — `SubscriptionRegistry` implementation that
    forwards supervisor events to `webContents.send`.
  - `errors.ts` — serializes thrown errors so the renderer's `invoke`
    rejects with a typed `Error`.
- `packages/desktop/tests/` — **NEW directory.** Tests for
  `subscriptions.ts` and `errors.ts` (no Electron required — those
  modules don't import `electron`).

## Files you must NOT touch

- `packages/api/src/handlers/**` — that's Stream 1.
- `packages/api/src/routes/**` — Stream 4 removes these.
- `packages/api/src/app.ts`, `packages/api/src/index.ts` — leave
  `startServer` alone for now.
- Anything under `packages/web/`.

## Work

### 1. Subscription registry — `packages/desktop/src/ipc/subscriptions.ts`

This module is pure (no `electron` import). It owns the lifecycle of every
agent-run event subscription.

```ts
import type {
  AgentEvent,
  AgentRun,
  AgentRunStatus,
  Card,
} from '@kanbots/local-store';
import type { AgentSupervisor, SubscriptionRegistry } from '@kanbots/api';

export interface ForwardEvent {
  (payload: AgentRunEventPayload): void;
}

export function createSubscriptionRegistry(opts: {
  supervisor: AgentSupervisor;
  forward: ForwardEvent;
}): SubscriptionRegistry & {
  // Stream 2-only extras for window-scoped cleanup.
  closeAllForOwner(ownerId: number): void;
};
```

Behavior:

- `register(runId, sinceSeq, onEvent, onCard, onStatus, onEnd)`:
  1. Generate a `subscriptionId` (UUID or counter — pick one and stick
     with it).
  2. Look up the run via `supervisor.getRun(runId)`. Throw `NotFound` if
     missing. Capture `runStatus`.
  3. Replay historical events: `supervisor.listEvents(runId, sinceSeq)`
     — call `onEvent` for each.
  4. Replay historical cards: `supervisor.listCards(runId)` — call
     `onCard` for each.
  5. If the run is active (`supervisor.isActive(runId)`), call
     `supervisor.subscribe(runId, …)` and stash the unsubscribe fn.
     Otherwise call `onStatus(runStatus)` and `onEnd()` synchronously
     (the run is already terminal — there's nothing more coming).
  6. Track the subscription internally as `{ subscriptionId, unsub,
     ownerId? }`. Return `{ subscriptionId, runStatus }`.
- `unregister(subscriptionId)`:
  1. Find the entry. No-op if missing (idempotent).
  2. Call its `unsub` if any.
  3. Remove from the map. Do **not** emit `kind: 'end'` — the renderer
     asked to stop.
- The internal `onStatus` from `register`: when the supervisor reports a
  terminal status (anything other than `starting`/`running`/`awaiting_input`),
  forward `kind: 'status'`, then `kind: 'end'`, then auto-unregister.

The "forward" callback is what the IPC layer plugs in. It looks like:

```ts
const forward: ForwardEvent = (payload) => {
  const sender = sendersBySubscription.get(payload.subscriptionId);
  if (!sender || sender.isDestroyed()) return;
  sender.send('agent-runs:events:data', payload);
};
```

The registry must also support associating a subscription with its owning
`webContents` so we can clean up when a window closes. Two options:

- Pass `ownerId` (a `webContents.id`) into `register`.
- Or expose `closeAllForOwner(ownerId)` and have the IPC layer call it
  when the window emits `'destroyed'`.

Pick the second; it's a tiny extension to the registry interface and keeps
the public `SubscriptionRegistry` (which Stream 1 typed) clean.

Test this module without Electron by passing fake `forward` and
`supervisor` callbacks.

### 2. Error serialization — `packages/desktop/src/ipc/errors.ts`

```ts
export function toIpcError(err: unknown): {
  name: string;
  message: string;
  // optional metadata copied off well-known error properties
  details?: unknown;
} {
  if (err instanceof Error) {
    const { name, message } = err;
    const details = (err as { run?: unknown }).run; // for AlreadyActive
    return details !== undefined
      ? { name, message, details }
      : { name, message };
  }
  return { name: 'UnknownError', message: String(err) };
}
```

`ipcMain.handle` already passes thrown errors back to the renderer; the
issue is that only `message` survives the structured-clone serialization,
not arbitrary properties. So the convention is: re-throw a plain `Error`
whose `message` is JSON-encoded:

```ts
ipcMain.handle(channel, async (_event, args) => {
  try {
    return await handler(args);
  } catch (err) {
    const ipcErr = toIpcError(err);
    throw new Error(JSON.stringify(ipcErr));
  }
});
```

The renderer's `invoke` parses the JSON message back into a typed error.
Stream 3 owns the parser side.

### 3. Channel registration — `packages/desktop/src/ipc/register.ts`

```ts
import { ipcMain, type WebContents } from 'electron';
import type { Handlers } from '@kanbots/api';
import { toIpcError } from './errors.js';

export function registerHandlers(handlers: Handlers): () => void {
  const registered: string[] = [];
  for (const channel of Object.keys(handlers) as (keyof Handlers)[]) {
    ipcMain.handle(`kanbots:invoke:${channel}`, async (_event, args) => {
      try {
        return await handlers[channel](args);
      } catch (err) {
        throw new Error(JSON.stringify(toIpcError(err)));
      }
    });
    registered.push(channel);
  }
  return () => {
    for (const channel of registered) {
      ipcMain.removeHandler(`kanbots:invoke:${channel}`);
    }
  };
}
```

The IPC channel name uses the prefix `kanbots:invoke:` so it can't collide
with the existing workspace lifecycle channels (`kanbots:bootstrap`,
`kanbots:open-workspace`, etc.).

### 4. Wire it up — `packages/desktop/src/main.ts`

When a workspace opens (the existing `openWorkspace` path), build the
`SubscriptionRegistry` and `Handlers`, register them, and stash the cleanup
function on the `ActiveWorkspace` record. When the workspace closes (or
when the window is destroyed), run cleanup.

Sketch:

```ts
import { createHandlers, type Handlers } from '@kanbots/api';
import { createSubscriptionRegistry } from './ipc/subscriptions.js';
import { registerHandlers } from './ipc/register.js';

// inside the workspace-open path, after supervisor / store / source / config exist:
const subscriptions = createSubscriptionRegistry({
  supervisor,
  forward: (payload) => {
    const sender = mainWindow?.webContents;
    if (!sender || sender.isDestroyed()) return;
    sender.send('agent-runs:events:data', payload);
  },
});
const handlers = createHandlers({
  deps: { source, store, config, supervisor, draftIssue },
  subscriptions,
});
const unregisterHandlers = registerHandlers(handlers);

// remember to attach cleanup to ActiveWorkspace:
activeWorkspace = {
  // … existing fields …
  unregisterHandlers,
  subscriptions,
};

// in the close path:
activeWorkspace.subscriptions.closeAllForOwner(activeWorkspace.ownerId);
activeWorkspace.unregisterHandlers();
```

Also wire `mainWindow.webContents.on('destroyed', () => subscriptions.closeAllForOwner(...))`
so a window reload doesn't leak supervisor listeners.

### 5. Preload — `packages/desktop/src/preload.ts`

Extend the existing `kanbots` object:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { ChannelName, ChannelArgs, ChannelResult } from '@kanbots/api';
import type { KanbotsBridge } from './types.js';

const api: KanbotsBridge = {
  // … existing lifecycle methods …

  invoke: <C extends ChannelName>(channel: C, args: ChannelArgs<C>) =>
    ipcRenderer.invoke(`kanbots:invoke:${channel}`, args) as Promise<
      ChannelResult<C>
    >,

  subscribe: (eventName, listener) => {
    const wrap = (_evt: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(eventName, wrap);
    return () => ipcRenderer.removeListener(eventName, wrap);
  },
};

contextBridge.exposeInMainWorld('kanbots', api);
```

### 6. Update `KanbotsBridge` — `packages/desktop/src/types.ts`

Add the two new methods. The renderer (Stream 3) imports this for its
`global.d.ts`.

```ts
import type { ChannelName, ChannelArgs, ChannelResult } from '@kanbots/api';

export interface KanbotsBridge {
  // … existing methods …
  invoke<C extends ChannelName>(
    channel: C,
    args: ChannelArgs<C>,
  ): Promise<ChannelResult<C>>;
  subscribe(eventName: string, listener: (payload: unknown) => void): () => void;
}
```

### 7. Tests — `packages/desktop/tests/`

Two test files at minimum:

- `subscriptions.test.ts` — instantiate the registry with a fake
  supervisor and a recording `forward`, exercise: register replays
  events, register on inactive run sends `status` + `end` immediately,
  unregister stops further forwards, terminal status auto-unregisters,
  `closeAllForOwner` cleans up.
- `errors.test.ts` — `toIpcError` preserves `name`, copies `details`
  off `AlreadyActive` errors, falls back for non-Error throws.

You don't have to test `register.ts` against real Electron. The
`ipcMain.handle` plumbing is trivial; if it works for one channel it
works for all of them. Smoke-test in the running app.

## Definition of done

- [ ] `packages/desktop/src/ipc/` exists with `register.ts`,
      `subscriptions.ts`, `errors.ts`.
- [ ] `packages/desktop/src/main.ts` calls `registerHandlers(handlers)`
      after a workspace opens and unregisters them on close + window
      destroy.
- [ ] `packages/desktop/src/preload.ts` exposes `invoke` and `subscribe`
      via `contextBridge`.
- [ ] `packages/desktop/src/types.ts` declares both methods on
      `KanbotsBridge`.
- [ ] `pnpm --filter '@kanbots/desktop' typecheck` is green.
- [ ] `pnpm --filter '@kanbots/desktop' test` is green.
- [ ] Manual smoke test: open the desktop app, paste this into the
      DevTools console:
      ```js
      await window.kanbots.invoke('issues:list', { state: 'open' });
      ```
      Returns the same issues the board renders. (You can do this even
      before Stream 3 ships — just run it from DevTools.)
- [ ] Manual smoke test for streams: subscribe to events for an active
      run via DevTools and confirm `agent-runs:events:data` events arrive
      live.

## Coordination

- You depend on **Stream 1**'s exports: `Handlers`, `createHandlers`,
  `BridgeChannels`, `ChannelName`, `ChannelArgs`, `ChannelResult`,
  `SubscriptionRegistry`. Until Stream 1 lands, you can stub these in a
  local `types-stub.ts` and swap to the real imports at merge time.
- **Stream 3** depends on the IPC channel naming you choose
  (`kanbots:invoke:${channel}` and `agent-runs:events:data`). If you
  rename, post in the pivot thread.
- **Stream 4** removes `startServer` from `main.ts`. To minimize merge
  conflicts, put your additions in a clearly delimited block (e.g.
  `// === IPC bridge (Stream 2) ===` to `// === end IPC bridge ===`).

## Sharp edges

- `ipcMain.handle` only allows one handler per channel. If you register
  twice (e.g. on workspace re-open without first unregistering), it
  throws. Always call `unregisterHandlers()` before the next
  registration.
- `webContents.send` to a destroyed window throws. Always guard with
  `isDestroyed()` checks.
- Structured-clone of `Uint8Array` works in IPC, but `Buffer` does not
  round-trip cleanly. Stream 1's `attachments:upload` should use
  `Uint8Array` end-to-end.
- The current `agent-runs:events` SSE has heartbeat pings every 15s.
  IPC doesn't need them — there's no proxy to keep alive. Drop them.

## Merge plan

1. Open PR `pivot/02-bridge` → `main` (or to `pivot/01-handlers` if it
   hasn't merged yet).
2. Merge after Stream 1 is in. The Express server still runs alongside
   IPC after this lands — that's intentional.
3. Stream 3 merges next; once the renderer is fully on IPC, Stream 4
   removes Express.
