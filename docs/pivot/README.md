# Pivot — kill the HTTP API, go IPC-only

Status: **planned, not started.** Read this whole doc before opening any of the
stream docs. It is the single source of truth for the contract every stream
must conform to.

## Why

`@kanbots/api` runs an Express HTTP server in-process and the renderer talks
to it over `fetch` + `EventSource`. We never use the HTTP boundary — there is
no remote client, no auth, no other consumer. The server is just IPC with
extra steps: serialization, port management, CORS, mime types, and an SSE
reconnect loop on top.

We are killing the web/HTTP version and routing every renderer request
through Electron IPC instead. The handler logic stays; the transport
changes.

This means:

- No more port 3737, no more `KANBOTS_API_PORT`, no more `startServer`.
- No more `fetch('/api/…')` in the renderer.
- No more `EventSource` for agent-run events.
- The renderer can no longer be opened in a plain browser. That mode is gone
  on purpose — the desktop app is the only consumer.

## Architecture: before → after

**Before**

```
renderer (web)  ── fetch/HTTP ──▶  Express (api)  ──▶  handlers ──▶  store / supervisor
       ▲                                │
       └────  EventSource/SSE ──────────┘
```

**After**

```
renderer (web)  ── window.kanbots.invoke ──▶  ipcMain.handle (desktop)  ──▶  handlers (api)  ──▶  store / supervisor
       ▲                                              │
       └────  window.kanbots.subscribe(...) ──────────┘
                  (webContents.send pushes events)
```

`@kanbots/api` becomes a pure handler library. `@kanbots/desktop` owns the
IPC bridge. `@kanbots/web` is unchanged structurally but has no HTTP
dependency and only runs inside Electron.

## The contract

Every operation the renderer needs lives behind one of two methods on
`window.kanbots`:

```ts
interface KanbotsBridge {
  invoke<C extends keyof BridgeChannels>(
    channel: C,
    args: BridgeChannels[C]['args'],
  ): Promise<BridgeChannels[C]['result']>;

  subscribe(
    eventName: string,
    listener: (payload: unknown) => void,
  ): () => void; // returns an unsubscribe fn
}
```

`BridgeChannels` is a TypeScript map keyed by channel name. **Stream 1**
defines and exports it from `@kanbots/api/src/bridge.ts`; everyone else
imports it.

**Channel naming convention.** Lowercase, colon-separated, resource-first:

```
issues:list
issues:get
issues:patch
issues:dispatch
agent-runs:get
agent-runs:stop
agent-runs:diff
agent-runs:events:subscribe       (stream)
agent-runs:events:unsubscribe     (stream)
cards:resolve
cost:today
workspace:get
folders:list
composer:draft
attachments:upload
```

Use the verb that matches the existing route's semantic, not the HTTP method.
`PATCH /api/issues/:n` becomes `issues:patch` (not `issues:update`); `POST
/api/issues/:n/archive` becomes `issues:archive`.

### Existing workspace channels

`window.kanbots` already exposes lifecycle channels (`bootstrap`,
`pickFolder`, `openWorkspace`, etc.) under the `kanbots:*` IPC namespace —
see `packages/desktop/src/preload.ts`. Those stay as-is. The new data
channels live alongside them under the same `window.kanbots` object but
with the structured `invoke()` method.

### Errors

Throw `Error` from a handler → the renderer's `invoke` rejects with
`new Error(serialized.message)`. Preserve a `name` field on the error so
the renderer can branch on `'AlreadyActive'`, `'NotFound'`, `'ValidationError'`,
etc. Map zod parse failures to `name: 'ValidationError'`.

### Streams (agent-run events)

The current `GET /api/agent-runs/:id/events` SSE endpoint becomes a
subscription. The handler registry exposes:

- `agent-runs:events:subscribe` — args `{ runId, sinceSeq?: number }`,
  returns `{ subscriptionId: string, runStatus: AgentRunStatus }`.
- `agent-runs:events:unsubscribe` — args `{ subscriptionId }`, returns `void`.

While a subscription is active, the main process forwards events to the
renderer via `webContents.send('agent-runs:events:data', payload)` where
`payload` is a discriminated union:

```ts
type AgentRunEventPayload =
  | { subscriptionId: string; kind: 'event'; event: AgentEvent }
  | { subscriptionId: string; kind: 'card'; card: Card }
  | { subscriptionId: string; kind: 'status'; status: AgentRunStatus }
  | { subscriptionId: string; kind: 'end' }; // sent once after final status, then no more events
```

The renderer filters by `subscriptionId`. On unsubscribe, the bridge calls
the supervisor's stored unsubscribe fn and never sends `kind: 'end'`.

When the renderer's `BrowserWindow` is destroyed, **Stream 2** must clean
up every subscription that targeted that window — leaks here will
keep the supervisor's listeners pinned and pile up over reloads.

## Channel inventory

This is the full surface to migrate, sourced from
`packages/api/src/routes/`. Each row is one channel. **Stream 1** writes the
canonical types in `@kanbots/api/src/bridge.ts`; this table is the
specification.

| Channel | Existing route | Args | Result |
| --- | --- | --- | --- |
| `config:get` | `GET /api/config` | `void` | `Config` |
| `issues:list` | `GET /api/issues` | `{ state?: 'open'\|'closed'\|'all' }` | `DecoratedIssue[]` |
| `issues:get` | `GET /api/issues/:n` | `{ number: number }` | `IssueDetail` |
| `issues:create` | `POST /api/issues` | `CreateIssueInput` | `DecoratedIssue` |
| `issues:patch` | `PATCH /api/issues/:n` | `{ number: number; patch: UpdateIssuePatch }` | `DecoratedIssue` |
| `issues:add-comment` | `POST /api/issues/:n/comments` | `{ number: number; body: string }` | `Comment` |
| `issues:post-message` | `POST /api/issues/:n/messages` | `{ number: number; body: string; dispatch?: boolean; model?: string; appendSystemPrompt?: string }` | `{ message: Message; thread: ThreadPayload; dispatchError?: string }` |
| `issues:list-runs` | `GET /api/issues/:n/runs` | `{ number: number }` | `AgentRun[]` |
| `issues:dispatch` | `POST /api/issues/:n/dispatch` | `{ number: number; fromStatus: StatusKey \| null; model?: string }` | `{ run: AgentRun; message: Message }` |
| `issues:start-agent` | `POST /api/issues/:n/agent/start` | `{ number: number; threadId: number; prompt: string; appendSystemPrompt?: string; model?: string }` | `AgentRun` |
| `issues:archive` | `POST /api/issues/:n/archive` | `{ number: number }` | `Issue` |
| `issues:approve` | `POST /api/issues/:n/pr/approve` | `{ number: number }` | `Issue` |
| `issues:request-changes` | `POST /api/issues/:n/pr/request-changes` | `{ number: number }` | `Issue` |
| `issues:split` | `POST /api/issues/:n/split` | `{ number: number; subtasks: Array<{ title: string; body?: string }>; dispatch?: boolean }` | `{ parent: number; children: Issue[] }` |
| `issues:reviewer` | `POST /api/issues/:n/reviewer` | `{ number: number; threadId?: number; prompt?: string; model?: string }` | `AgentRun` |
| `agent-runs:get` | `GET /api/agent-runs/:id` | `{ runId: number }` | `AgentRun` |
| `agent-runs:stop` | `POST /api/agent-runs/:id/stop` | `{ runId: number }` | `AgentRun` |
| `agent-runs:diff` | `GET /api/agent-runs/:id/diff` | `{ runId: number }` | `DiffPayload` |
| `agent-runs:stats` | `GET /api/agent-runs/:id/stats` | `{ runId: number }` | `{ additions: number; deletions: number; filesChanged: number }` |
| `agent-runs:checks:list` | `GET /api/agent-runs/:id/checks` | `{ runId: number }` | `AgentCheck[]` |
| `agent-runs:checks:run` | `POST /api/agent-runs/:id/checks/run` | `{ runId: number; kinds?: CheckKind[] }` | `AgentCheck[]` |
| `agent-runs:preview:get` | `GET /api/agent-runs/:id/preview` | `{ runId: number }` | `PreviewStatePayload` |
| `agent-runs:preview:start` | `POST /api/agent-runs/:id/preview/start` | `{ runId: number }` | `PreviewStatePayload` |
| `agent-runs:preview:stop` | `POST /api/agent-runs/:id/preview/stop` | `{ runId: number }` | `PreviewStatePayload` |
| `agent-runs:fork` | `POST /api/agent-runs/:id/fork` | `{ runId: number }` | `{ source: number; run: AgentRun; worktree: string; branch: string }` |
| `agent-runs:events:subscribe` | `GET /api/agent-runs/:id/events` (SSE) | `{ runId: number; sinceSeq?: number }` | `{ subscriptionId: string; runStatus: AgentRunStatus }` |
| `agent-runs:events:unsubscribe` | (close SSE connection) | `{ subscriptionId: string }` | `void` |
| `cards:resolve` | `POST /api/cards/:id/resolve` | `{ cardId: number; value: string }` | `{ card: Card; run: AgentRun }` |
| `decisions:pending` | `GET /api/decisions/pending` | `void` | `PendingDecisionPayload[]` |
| `cost:today` | `GET /api/cost/today` | `void` | `{ totalUsd: number; since: string }` |
| `workspace:get` | `GET /api/workspace` | `void` | `Workspace` |
| `folders:list` | `GET /api/folders` | `void` | `WorkspaceFolderPayload[]` |
| `folders:add` | `POST /api/folders` | `{ name: string; path: string; defaultBranch?: string }` | `WorkspaceFolderPayload` |
| `composer:draft` | `POST /api/composer/draft` | `{ description: string }` | `DraftedIssue` |
| `attachments:upload` | `POST /api/attachments` | `{ contentType: string; data: Uint8Array }` | `UploadAttachmentResult` |

> Note: `attachments:upload` switches from base64-over-JSON to a raw
> `Uint8Array`. IPC structured-clone supports it natively; no need to
> base64-encode anymore.

If you find a route in `packages/api/src/routes/` that's not in this table,
add it. Don't ship a hidden surface.

## Stream layout

Four streams, disjoint file ownership. Each runs in its own git worktree on
its own branch off `main`. They merge in this order:

1. **Stream 1 — handlers** (`pivot/01-handlers`)
2. **Stream 2 — bridge** (`pivot/02-bridge`)
3. **Stream 3 — renderer** (`pivot/03-renderer`)
4. **Stream 4 — demolition** (`pivot/04-demolition`)

Streams 1, 2, 3 can develop concurrently. They reference this contract; no
stream waits on another's code. **Stream 4 must merge last** — it deletes
the Express server, which the others coexist with during development.

### File ownership

Each stream's doc has the canonical "Files you own / Files you must NOT
touch" list. The summary:

| Stream | Owns | Forbidden |
| --- | --- | --- |
| 1 | `packages/api/src/handlers/**` (new), `packages/api/src/bridge.ts` (new), `packages/api/src/index.ts` (additive exports), `packages/api/tests/handlers/**` (new) | `packages/api/src/routes/**`, `packages/api/src/app.ts`, anything under `packages/desktop` or `packages/web` |
| 2 | `packages/desktop/src/main.ts`, `packages/desktop/src/preload.ts`, `packages/desktop/src/types.ts`, `packages/desktop/src/ipc/**` (new), `packages/desktop/tests/**` (new) | `packages/api/src/routes/**`, `packages/api/src/app.ts`, anything under `packages/web` |
| 3 | `packages/web/src/api.ts`, `packages/web/src/hooks/useAgentRunStream.ts`, `packages/web/src/global.d.ts` (new), `packages/web/package.json` (deps) | anything under `packages/api`, `packages/desktop` |
| 4 | `packages/api/src/app.ts` (delete), `packages/api/src/routes/**` (delete), `packages/api/src/middleware/**` (delete), `packages/api/tests/*-create.test.ts` etc. (delete or rewrite), `packages/api/package.json` (remove deps), `packages/desktop/src/main.ts` (remove `startServer`), `README.md`, `design_plan/REFACTOR_PLAN.md`, `docs/pivot/COMPLETED.md` (new) | new handler logic, new bridge logic, renderer logic |

Stream 1 and Stream 2 both touch `packages/api/src/index.ts` — Stream 1 only
*adds* exports, Stream 4 *removes* old ones. No conflict if Stream 4 lands
last.

Stream 2 and Stream 4 both touch `packages/desktop/src/main.ts` — Stream 2
adds IPC handlers (in a new section); Stream 4 removes the `startServer`
call. Coordinate by keeping Stream 2's edits adjacent and Stream 4's edits
to a localized block.

### Coexistence period

While Streams 1, 2, 3 are in flight, the Express server keeps running. The
renderer can mix `fetch` and `window.kanbots.invoke` — Stream 3 should
migrate one screen at a time and verify nothing regresses. **Stream 4
guarantees the Express server is gone before merging.**

## Acceptance — pivot is complete when

- [ ] `packages/api/src/app.ts`, `packages/api/src/routes/`, and Express
      do not exist in the repo.
- [ ] `packages/api/package.json` has no `express`, `cors`, `helmet`, or
      `supertest` dependency.
- [ ] `packages/desktop/src/main.ts` has no `startServer` call, no
      `KANBOTS_API_PORT` reference.
- [ ] `packages/web/src/api.ts` does not import `fetch` or call
      `EventSource`.
- [ ] `pnpm build && pnpm typecheck && pnpm test` is green.
- [ ] `pnpm desktop:dev` opens, lets you create / drag / dispatch / open
      a ticket, see agent activity stream in, resolve decisions, and
      stop runs — without the API server running.

## Conventions for every stream

- TypeScript strict mode is on. No `any`, no `as unknown as`. If you need
  an escape hatch, write a typed parser.
- Tests live next to the code they cover (`packages/<pkg>/tests/...`). New
  handler tests use vitest directly (no supertest).
- Don't edit `packages/local-store`, `packages/core`, or `packages/dispatcher`
  unless you find a missing export. If you do, link the change in your
  stream's PR description.
- One stream = one PR. Keep diffs reviewable (~500-1500 lines).
- Document any deviation from this contract in the PR description and ping
  the human running the pivot.

## FAQ

**Q: Can the renderer call the supervisor directly?**
No. Always go through a handler. The supervisor lives in the main process;
exposing it directly would defeat the bridge boundary and break process
isolation.

**Q: Does Vite still serve the renderer over HTTP in dev mode?**
Yes. `pnpm desktop:dev` keeps Vite for HMR — Electron loads
`http://127.0.0.1:5173`. That's an internal Electron concern, not a public
HTTP API. The renderer never makes its own HTTP requests.

**Q: How does the renderer handle the bridge being missing (e.g. running
in jsdom for tests)?**
The renderer's `api.ts` should detect `typeof window.kanbots === 'undefined'`
and throw a clear error. Tests that need data should mock `window.kanbots`
directly via a test helper (Stream 3 should ship one).

**Q: What about file uploads (attachments)?**
IPC structured-clone serializes `Uint8Array` natively. The renderer reads
the file with `FileReader.readAsArrayBuffer` (or `Blob.arrayBuffer()`),
passes the buffer through `invoke('attachments:upload', { contentType,
data })`. No more base64 round-trip.

**Q: What if a handler needs to know which window the request came from?**
`ipcMain.handle((event, ...args) => …)` exposes `event.sender`. For
subscriptions specifically, Stream 2 must pass `event.sender` into the
subscription registry so it can clean up when the window closes.
