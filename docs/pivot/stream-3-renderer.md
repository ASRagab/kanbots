# Stream 3 — Renderer migration to IPC

> Read `docs/pivot/README.md` first. The contract there is binding.

## Mission

Rewrite the renderer's data layer so every call goes through
`window.kanbots.invoke` and every stream goes through
`window.kanbots.subscribe`. No `fetch`, no `EventSource`, no
`apiUrl` in `@kanbots/web` after this stream lands.

The Express server keeps running during the coexistence period — Stream 4
deletes it. While Streams 1, 2, 3 are concurrent, you can develop against
a stub bridge (see "If Stream 2 isn't done yet" below).

## Branch

```sh
git checkout -b pivot/03-renderer
```

## Files you own

- `packages/web/src/api.ts` — **REWRITE.** Same exported shape (the
  `api` object), new transport (`window.kanbots.invoke`).
- `packages/web/src/hooks/useAgentRunStream.ts` — **REWRITE.** Replace
  `EventSource` with `window.kanbots.subscribe`.
- `packages/web/src/global.d.ts` — **NEW.** Declare `window.kanbots`
  with the bridge type.
- `packages/web/package.json` — **MODIFY.** Add `@kanbots/api` as a
  workspace dependency (for type-only imports of `BridgeChannels`).
- `packages/web/src/test-utils/bridge.ts` — **NEW.** Test helper that
  installs a fake `window.kanbots` for component tests (if any exist)
  and for development without Stream 2.

## Files you must NOT touch

- Anything under `packages/api/`.
- Anything under `packages/desktop/`.
- Component files (`packages/web/src/components/**`,
  `packages/web/src/pages/**`) **except** to fix calls into the rewritten
  `api.ts` if their type signatures changed (rare — keep them stable).

## Work

### 1. Add the type-only dependency

`packages/web/package.json`:

```json
{
  "devDependencies": {
    "@kanbots/api": "workspace:*"
  }
}
```

(Use `devDependencies` because we only consume types — no runtime imports
from `@kanbots/api`.)

Run `pnpm install` to refresh the lockfile.

### 2. Declare the bridge — `packages/web/src/global.d.ts`

```ts
import type { KanbotsBridge } from '@kanbots/desktop/src/types';

declare global {
  interface Window {
    kanbots: KanbotsBridge;
  }
}

export {};
```

> If pulling types directly from `@kanbots/desktop` causes pnpm pain
> (it's not a runtime dep of web), inline the minimal interface here
> using `BridgeChannels` from `@kanbots/api`:
>
> ```ts
> import type {
>   ChannelName,
>   ChannelArgs,
>   ChannelResult,
> } from '@kanbots/api';
>
> interface KanbotsBridge {
>   invoke<C extends ChannelName>(
>     channel: C,
>     args: ChannelArgs<C>,
>   ): Promise<ChannelResult<C>>;
>   subscribe(
>     eventName: string,
>     listener: (payload: unknown) => void,
>   ): () => void;
>   // plus the existing lifecycle methods you need…
> }
> ```

Pick whichever fits the existing pnpm workspace config better.

### 3. Rewrite `api.ts`

The current `api` object is a flat record of methods like
`api.issue(7)`, `api.startAgent(...)`, etc. Keep the public shape; swap
the implementation.

Pattern:

```ts
import type {
  ChannelName,
  ChannelArgs,
  ChannelResult,
} from '@kanbots/api';

function invoke<C extends ChannelName>(
  channel: C,
  args: ChannelArgs<C>,
): Promise<ChannelResult<C>> {
  if (typeof window === 'undefined' || !window.kanbots?.invoke) {
    throw new Error(`window.kanbots not available — renderer must run inside Electron`);
  }
  return window.kanbots.invoke(channel, args).catch(translateBridgeError);
}

function translateBridgeError(err: unknown): never {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message) as { name: string; message: string; details?: unknown };
      const next = new Error(parsed.message);
      next.name = parsed.name;
      if (parsed.details !== undefined) {
        (next as { details?: unknown }).details = parsed.details;
      }
      throw next;
    } catch {
      throw err;
    }
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export const api = {
  config: () => invoke('config:get', undefined),
  issues: (state: 'open' | 'closed' | 'all' = 'open') =>
    invoke('issues:list', { state }),
  issue: (n: number) => invoke('issues:get', { number: n }),
  updateIssue: (n: number, patch: UpdateIssuePatch) =>
    invoke('issues:patch', { number: n, patch }),
  archiveIssue: (n: number) => invoke('issues:archive', { number: n }),
  // …one method per row in the contract table…

  // Streams: see useAgentRunStream below — api.ts doesn't expose the
  // subscribe directly because it needs lifecycle.
} as const;
```

The error translator unwraps Stream 2's JSON-encoded error envelope. The
renderer code that catches errors (e.g. `Board.tsx` displaying
"AlreadyActive") relies on `err.name` — this preserves it.

`apiUrl()` and the `baseUrl` global go away. `configureApi()` goes away.
The desktop's `KANBOTS_API_PORT` plumbing is dead code that Stream 4
removes.

#### Attachments

Switch `uploadAttachment` from base64 to a buffer:

```ts
uploadAttachment: async (file: Blob): Promise<UploadAttachmentResult> => {
  const data = new Uint8Array(await file.arrayBuffer());
  return invoke('attachments:upload', {
    contentType: file.type || 'application/octet-stream',
    data,
  });
},
```

### 4. Rewrite `useAgentRunStream`

Same exported shape (`{ events, cards, status, error }`), new transport.

```ts
import { useEffect, useState } from 'react';
import type { AgentEvent, AgentRunStatus, Card } from '../types.js';
import type { AgentRunEventPayload } from '@kanbots/api';

export interface AgentRunStreamState {
  events: AgentEvent[];
  cards: Card[];
  status: AgentRunStatus | null;
  error: string | null;
}

export function useAgentRunStream(runId: number | null): AgentRunStreamState {
  const [state, setState] = useState<AgentRunStreamState>({
    events: [],
    cards: [],
    status: null,
    error: null,
  });

  useEffect(() => {
    if (runId === null) {
      setState({ events: [], cards: [], status: null, error: null });
      return;
    }

    let cancelled = false;
    let subscriptionId: string | null = null;
    let unsubscribe: (() => void) | null = null;

    setState({ events: [], cards: [], status: null, error: null });

    void window.kanbots
      .invoke('agent-runs:events:subscribe', { runId })
      .then(({ subscriptionId: subId, runStatus }) => {
        if (cancelled) {
          void window.kanbots.invoke('agent-runs:events:unsubscribe', {
            subscriptionId: subId,
          });
          return;
        }
        subscriptionId = subId;
        setState((prev) => ({ ...prev, status: runStatus }));
        unsubscribe = window.kanbots.subscribe(
          'agent-runs:events:data',
          (payload) => {
            const p = payload as AgentRunEventPayload;
            if (p.subscriptionId !== subId) return;
            if (p.kind === 'event') {
              setState((prev) => {
                if (prev.events.some((existing) => existing.seq === p.event.seq)) {
                  return prev;
                }
                const next = [...prev.events, p.event].sort((a, b) => a.seq - b.seq);
                return { ...prev, events: next };
              });
            } else if (p.kind === 'card') {
              setState((prev) => {
                const exists = prev.cards.some((c) => c.id === p.card.id);
                return exists
                  ? { ...prev, cards: prev.cards.map((c) => (c.id === p.card.id ? p.card : c)) }
                  : { ...prev, cards: [...prev.cards, p.card] };
              });
            } else if (p.kind === 'status') {
              setState((prev) => ({ ...prev, status: p.status }));
            }
            // 'end' → main process auto-cleans the subscription; nothing to do.
          },
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : String(err),
        }));
      });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      if (subscriptionId) {
        void window.kanbots.invoke('agent-runs:events:unsubscribe', {
          subscriptionId,
        });
      }
    };
  }, [runId]);

  return state;
}
```

Note: deduplication by `seq` is preserved — the registry replays history
on subscribe, and live events come through the same channel with new
`seq` values, so the dedupe stays correct.

### 5. Test helper — `packages/web/src/test-utils/bridge.ts`

Provide a `installFakeBridge` for component tests and dev-mode fallback:

```ts
import type { ChannelName, ChannelArgs, ChannelResult } from '@kanbots/api';

type Handlers = {
  [C in ChannelName]?: (args: ChannelArgs<C>) => Promise<ChannelResult<C>>;
};

export function installFakeBridge(handlers: Handlers): void {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  (globalThis as { window?: typeof window }).window = (globalThis as { window?: typeof window }).window ?? ({} as Window);
  (window as { kanbots?: unknown }).kanbots = {
    invoke: async <C extends ChannelName>(channel: C, args: ChannelArgs<C>) => {
      const fn = handlers[channel];
      if (!fn) throw new Error(`fake bridge: no handler for ${channel}`);
      return fn(args);
    },
    subscribe: (eventName: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(eventName) ?? new Set();
      set.add(listener);
      listeners.set(eventName, set);
      return () => set.delete(listener);
    },
    push: (eventName: string, payload: unknown) => {
      listeners.get(eventName)?.forEach((l) => l(payload));
    },
  };
}
```

Note the extra `push` method — that's a test-only escape hatch for
driving `subscribe` listeners. Type it as a private extension; production
code should not use it.

### 6. Spot-check every consumer

Grep the renderer for `fetch(` and `EventSource(`:

```sh
git grep -nE 'fetch\(|EventSource\(' packages/web/src
```

Every match should be inside `api.ts` or `useAgentRunStream.ts` —
nowhere else. If you find one elsewhere, that's a renderer module
talking to HTTP directly; route it through `api`.

Also grep for `apiUrl(` and `configureApi(` — those should be removed
from the codebase entirely after this stream.

## Definition of done

- [ ] `packages/web/src/api.ts` has zero `fetch` / `EventSource` /
      `apiUrl` references.
- [ ] `packages/web/src/hooks/useAgentRunStream.ts` uses
      `window.kanbots.subscribe`.
- [ ] `packages/web/src/global.d.ts` declares `window.kanbots`.
- [ ] `git grep -nE 'fetch\(|EventSource\(' packages/web/src` returns
      nothing (or only matches inside the test helper, if it stubs
      something).
- [ ] `pnpm --filter '@kanbots/web' typecheck` is green.
- [ ] `pnpm desktop:dev` opens, the board loads, you can drag a card,
      dispatch an agent, and the Thread tab streams events live.
- [ ] DevTools network tab shows **zero** `fetch` calls to
      `/api/...` from the renderer.

## Coordination

- You depend on **Stream 2** for `window.kanbots.invoke/subscribe`. If
  Stream 2 isn't merged yet, install your fake bridge in
  `packages/web/src/main.tsx` behind a `import.meta.env.DEV` flag, or
  point at an unmerged branch via pnpm `link`.
- You depend on **Stream 1** for `BridgeChannels` types. Use type-only
  imports.

### If Stream 2 isn't done yet

For local dev, add a temporary fallback in `main.tsx`:

```ts
import { installFakeBridge } from './test-utils/bridge.js';

if (typeof window.kanbots?.invoke !== 'function') {
  // Until pivot/02-bridge lands, route through the legacy HTTP API.
  installLegacyHttpBridge();
}
```

Don't ship `installLegacyHttpBridge` — keep it on a separate branch you
toss before merging. The merged version of this stream depends on the
real bridge.

## Sharp edges

- `useFetch` keys cache by URL string. After this rewrite, those keys
  become channel-name-style strings (`'issues:7'` etc.). They were
  always opaque — keep them stable so cached entries continue to work
  during incremental re-renders.
- The renderer historically caught HTTP errors with `err.message`
  matching `'404 Not Found on /api/…'`. After this stream those go away;
  errors carry a `name` (e.g. `'NotFound'`) and a clean `message`.
  Audit the few places (mostly in modals and the inspector) that match
  on error message text — switch them to match on `err.name`.
- Don't keep the `baseUrl` / `configureApi` exports for "compatibility"
  — there's no remote consumer. Delete cleanly so Stream 4's audit is
  trivial.
- The streaming SSE reconnect-on-error behavior is gone. IPC doesn't
  drop; if it does, the window is dead and the renderer should reload
  the workspace anyway.

## Merge plan

1. Open PR `pivot/03-renderer` → `main` (or to a stacked target if
   Stream 1/2 hasn't merged yet).
2. Merge after Streams 1 and 2 land.
3. The Express server is still running after this PR; the renderer
   simply ignores it. Stream 4 deletes it.
