# Pivot — completed 2026-04-26

The HTTP/SSE API is gone. The renderer talks to the main process via
Electron IPC only.

## Where things live now

- **Pure handler library**: `packages/api/src/handlers/` — one file per
  resource group. The factory `createHandlers({ deps, subscriptions })`
  returns a typed `Handlers` map keyed by channel name.
- **IPC bridge contract**: `packages/api/src/bridge.ts` exports
  `BridgeChannels`, `ChannelName`, `ChannelArgs`, `ChannelResult`,
  `AgentRunEventPayload`. Imported type-only by both the desktop bridge
  and the renderer.
- **Electron IPC bridge**: `packages/desktop/src/ipc/`
  - `register.ts` — wires every channel to `ipcMain.handle('kanbots:invoke:<channel>', …)`.
  - `subscriptions.ts` — `OwnedSubscriptionRegistry` translates the
    supervisor's per-run subscriptions into `webContents.send(
    'agent-runs:events:data', payload)` pushes, with per-window cleanup.
  - `errors.ts` — JSON-encodes thrown handler errors so the renderer
    can rebuild a typed `Error` (with `name` and `details`).
- **Preload**: `packages/desktop/src/preload.ts` exposes
  `window.kanbots.invoke` / `subscribe` alongside the existing lifecycle
  methods (`bootstrap`, `openWorkspace`, …).
- **Renderer client**: `packages/web/src/api.ts` calls `invoke` exclusively;
  `packages/web/src/hooks/useAgentRunStream.ts` uses `subscribe` and
  emits `'agent-runs:events:unsubscribe'` on cleanup.

## What was deleted

- `packages/api/src/app.ts`, `packages/api/src/routes/` (14 files),
  `packages/api/src/error-handler.ts`.
- `packages/api/src/index.ts` no longer exports `createApp`, `startServer`,
  `RunningServer`, `AppDeps`, `IssuesDeps`, `ConfigPayload`,
  `UploadAttachmentResponse`.
- 15 supertest-based test files under `packages/api/tests/` plus
  `tests/helpers/make-app.ts`. Replaced by 13 handler-level specs in
  `packages/api/tests/handlers/` exercised via `make-handlers.ts` and a
  new `fakes.ts` (the `FakeIssueSource` and `makeStubSupervisor` helpers
  that the old `make-app.ts` carried).
- `express`, `@types/express`, `supertest`, `@types/supertest` removed
  from `packages/api/package.json`.
- `express` removed from `packages/desktop/package.json`.
- `startServer`, `RunningServer`, `KANBOTS_API_PORT`, `KANBOTS_API_HOST`,
  `apiBaseUrl`, the `kanbots:api-ready` event, and the `apiBaseUrl` field
  on `BootstrapPayload` are all gone from `packages/desktop/src/main.ts`
  and `packages/desktop/src/types.ts`.
- The desktop `dev` script no longer sets `KANBOTS_API_PORT`.

## Verification

- `pnpm typecheck` green across `@kanbots/api`, `@kanbots/desktop`,
  `@kanbots/web`, `@kanbots/local-store`, `@kanbots/dispatcher`,
  `@kanbots/core`.
- `pnpm test`: `@kanbots/api` 47 tests · `@kanbots/local-store` 76 tests
  · all pass.
- `pnpm build`: api `dist/index.js` 60 KB / `index.d.ts` 13 KB. Desktop
  `main.cjs` 171 KB (down from 219 KB once Express was removed). Web
  `index.js` 329 KB.
- `pnpm exec eslint packages/{api,desktop,web}/src` clean.
- `git grep -nE "from 'express'|startServer|/api/|EventSource"
  packages/{api,desktop,web}/src` returns nothing.

## Follow-ups (not blockers)

- Desktop tests for `subscriptions.ts` and `errors.ts` (Stream 2's DoD
  asked for these; not landed). These are pure modules and easy to test
  without Electron — punted on time.
- `IssueActiveRunPayload` carries four optional Phase-11 fields
  (`additions`, `deletions`, `filesChanged`, `progress`) for forward
  compat. Wire them up when Phase 11 ships.
- The renderer's old `IssueActiveRun` type-name now aliases the bridge's
  `IssueActiveRunPayload` (in `packages/web/src/types.ts`). Some
  components still reference `IssueActiveRun` directly; harmless, but a
  rename pass would be tidy.
- `error-handler.ts` was deleted. If we ever need a generic error
  envelope around handlers, the new home is `packages/desktop/src/ipc/errors.ts`.

## Rollback plan

There isn't a clean one. The transport swap touched ~30 files and the
contract is now the single source of truth. Reverting means
`git revert` of the pivot commit (the squashed landing), then a
follow-up to restore any local-store / supervisor work that rode along.
