# Stream 4 — Demolition: kill Express, the HTTP server, and the web mode

> Read `docs/pivot/README.md` first. The contract there is binding.

## Mission

Delete every HTTP/Express artifact from the repo, remove the `KANBOTS_API_PORT`
plumbing, drop dead dependencies, and update the docs (README + REFACTOR_PLAN)
to reflect the new IPC-only architecture.

You **must merge last**. Streams 1, 2, and 3 coexist with the Express
server during their development. Once all three have landed and the
desktop app is verified working over IPC, this stream removes the bridge.

## Branch

```sh
git checkout -b pivot/04-demolition
```

You cannot start meaningful work on this branch until **Streams 1, 2, 3
have merged into `main`** (or wherever the pivot is being staged).
Before then, you can start the docs-only portion (README, REFACTOR_PLAN
updates) on a separate branch and rebase.

## Files you own

### Delete

- `packages/api/src/app.ts`
- `packages/api/src/routes/` — entire directory (all 14 files).
- `packages/api/src/middleware/` — if it exists.
- Express-only tests:
  - `packages/api/tests/issues-detail.test.ts`
  - `packages/api/tests/issues-list.test.ts`
  - `packages/api/tests/issues-create.test.ts`
  - `packages/api/tests/issues-update.test.ts`
  - `packages/api/tests/issues-dispatch.test.ts`
  - `packages/api/tests/messages-create.test.ts`
  - `packages/api/tests/comments-create.test.ts`
  - `packages/api/tests/cards-resolve.test.ts`
  - `packages/api/tests/composer-draft.test.ts`
  - `packages/api/tests/agent-runs.test.ts`
  - `packages/api/tests/workspace-routes.test.ts`
  - `packages/api/tests/workspace-reconcile.test.ts` — keep if it tests
    the reconcile function directly; delete if it tests via supertest.
  - `packages/api/tests/supervisor.test.ts` — keep (tests the
    supervisor, not routes).
  - `packages/api/tests/helpers/make-app.ts` — delete (creates Express
    app for tests). Replace with a `make-handlers.ts` helper that
    spins up `createHandlers` for handler tests, if Stream 1 didn't
    already.
  - `packages/api/tests/helpers/fixtures.ts` — keep (issue fixtures).

  Use your judgment: any test file that boots an Express app via
  `makeTestApp()` is gone. Tests that call handlers directly stay.

### Modify

- `packages/api/src/index.ts` — Remove `createApp`, `startServer`, the
  `Express` re-exports, and any HTTP-only types.
- `packages/api/package.json` — Remove deps:
  - `express`, `cors` (if present), `helmet` (if present)
  - `supertest`, `@types/express`, `@types/supertest`
  - Anything else that's only used by `app.ts` or routes.
- `packages/api/tsup.config.ts` (or wherever it lives) — Confirm it
  still builds the slimmer entry.
- `packages/desktop/src/main.ts`:
  - Remove the `import { startServer } from '@kanbots/api'`.
  - Remove the entire workspace-bootstrapping section that calls
    `startServer`, captures the port, and stores it on
    `ActiveWorkspace.server`.
  - Remove `KANBOTS_API_PORT` env var handling.
  - Remove `RunningServer` interface from `types.ts` if unused
    elsewhere.
  - Remove the `KANBOTS_API_HOST` / `apiBaseUrl` injection into the
    renderer (the renderer no longer needs it).
- `packages/desktop/package.json`:
  - Remove `express` if listed.
- `packages/web/src/api.ts` — confirm `apiUrl()`, `configureApi()`,
  `baseUrl` are gone. (Stream 3 should have removed them, but verify.)
- `packages/web/src/main.tsx` (or wherever `configureApi` was called) —
  remove the call.
- Root `package.json`:
  - Drop any `dev:api` / `start:api` scripts if they exist.
  - Update `desktop:dev` / `desktop` if they reference port 3737.
- `README.md` — Rewrite the "Run it" section to reflect that Vite serves
  the renderer for HMR but no API server runs. Add a one-liner about
  the IPC-only architecture.
- `design_plan/REFACTOR_PLAN.md` — Mark phases that referenced the HTTP
  API surface as superseded. Add a brief note linking to
  `docs/pivot/README.md`.
- `docs/pivot/COMPLETED.md` — **NEW.** A short post-mortem (1 page max)
  documenting what was done, what files moved where, and any
  follow-ups.

### Files you must NOT touch

- `packages/api/src/handlers/**` — Stream 1 territory, stable.
- `packages/api/src/bridge.ts` — Stream 1 territory.
- `packages/desktop/src/ipc/**` — Stream 2 territory.
- `packages/desktop/src/preload.ts` — Stream 2 territory.
- `packages/web/src/api.ts` content (you may verify but not change
  semantics) — Stream 3 territory.
- `packages/local-store/**`, `packages/core/**`, `packages/dispatcher/**`
  — unrelated to the pivot.

## Work

### 1. Pre-flight checklist (gate)

Before deleting anything:

- [ ] Streams 1, 2, 3 are merged.
- [ ] `pnpm desktop:dev` works end-to-end on the integrated branch:
  - Open a workspace.
  - Board renders.
  - Drag a card to In Progress; agent dispatches; decision card
    appears in the modal.
  - Resolve the decision; agent resumes.
  - Stop the run from the modal header.
  - Open another issue; Thread/Diff/Preview/Runs tabs all populate.
- [ ] DevTools Network panel: zero `fetch` calls under `/api/`,
  zero open EventSources.
- [ ] `pnpm typecheck` green across all packages.
- [ ] `pnpm test` green.

If any check fails, open an issue and pause this stream — don't
demolish over a broken integration.

### 2. Delete in order

```sh
# 1. Routes + app
rm -rf packages/api/src/routes
rm packages/api/src/app.ts
rm -rf packages/api/src/middleware  # if present
rm -rf packages/api/src/server.ts   # if there's a separate file

# 2. Express tests + helper
git rm packages/api/tests/issues-detail.test.ts \
       packages/api/tests/issues-list.test.ts \
       packages/api/tests/issues-create.test.ts \
       packages/api/tests/issues-update.test.ts \
       packages/api/tests/issues-dispatch.test.ts \
       packages/api/tests/messages-create.test.ts \
       packages/api/tests/comments-create.test.ts \
       packages/api/tests/cards-resolve.test.ts \
       packages/api/tests/composer-draft.test.ts \
       packages/api/tests/agent-runs.test.ts \
       packages/api/tests/workspace-routes.test.ts \
       packages/api/tests/helpers/make-app.ts
# Re-evaluate workspace-reconcile.test.ts and supervisor.test.ts
# individually; keep if they don't use supertest.
```

Re-run `pnpm typecheck` after each delete. Fix imports as they break.
Most failures will be in `packages/api/src/index.ts` (removed exports)
— update the export list to match the post-pivot surface (handlers,
bridge types, supervisor, supporting types).

### 3. Trim `packages/api/package.json`

Remove from `dependencies` / `devDependencies`:

- `express`
- `@types/express`
- `cors` (if present)
- `helmet` (if present)
- `supertest`
- `@types/supertest`

Keep:

- `zod` (handlers still use it for input validation).
- `better-sqlite3`, `@kanbots/*` workspaces.
- `vitest`, `tsup`, `typescript`.

Run `pnpm install` to refresh the lockfile. `pnpm-lock.yaml` should
shrink visibly.

### 4. Trim `packages/desktop/src/main.ts`

The current bootstrap roughly looks like:

```ts
const server = await startServer({ deps, host: '127.0.0.1', port: KANBOTS_API_PORT });
activeWorkspace = { …, server };
mainWindow.webContents.send('kanbots:api-ready', { host: server.host, port: server.port });
```

Remove all of that. The IPC handlers (registered by Stream 2) are
sufficient. Remove:

- The `import { startServer } from '@kanbots/api'`.
- The `port`/`host` plumbing.
- `RunningServer` interface (delete if unused).
- The `kanbots:api-ready` IPC event broadcast.
- The `KANBOTS_API_PORT` and `KANBOTS_API_HOST` reads from `process.env`.

The workspace open flow now:

1. Build store / source / supervisor / draftIssue / config.
2. Build subscriptions registry + handlers (Stream 2).
3. `registerHandlers(handlers)`.
4. `mainWindow.loadFile(...)` or `loadURL(...)`.

That's it. No HTTP listener.

### 5. Trim env / scripts

- `packages/desktop/package.json`'s `dev` script currently sets
  `KANBOTS_API_PORT=3737`. Remove that env. Same for `KANBOTS_API_HOST`.
- Root `package.json` `desktop` and `desktop:dev` scripts: scrub any
  port references.
- `wait-on http://127.0.0.1:5173` — keep, that's the Vite renderer dev
  server, not the API.

### 6. Update README

Rewrite the "Run it" section. Keep it terse — the existing tone is
right.

```md
## Run it

Requires Node 20+, pnpm 10+, and `claude` on PATH for agent runs.

Install once:

```sh
pnpm install
```

Launch the desktop app:

```sh
pnpm desktop          # builds web + main, opens Electron
pnpm desktop:dev      # Vite hot-reload + Electron pointing at it
```

A workspace picker opens. Pick any folder that contains a git repository
— the app creates `.kanbots/` (db + config + worktrees dir) on first
open and drops straight into the kanban board.

The renderer talks to the main process exclusively via Electron IPC.
There is no HTTP server. Web-only mode is not supported.
```

Update the package table to reflect that `@kanbots/api` is now a
handler library, not an HTTP server.

### 7. Update `design_plan/REFACTOR_PLAN.md`

Add a callout near the top:

```md
> **Note (post-pivot):** the architecture has shifted to IPC-only. The
> Express + SSE plumbing referenced in the phases below has been
> replaced by `window.kanbots.invoke` / `subscribe`. See
> `docs/pivot/README.md` for the new contract.
```

Don't rewrite the plan — just signpost. The phase docs are still
valuable as feature roadmap; only the transport assumption changed.

### 8. Write `docs/pivot/COMPLETED.md`

One page. Cover:

- What changed (one paragraph).
- Where the handlers live now (link to `packages/api/src/handlers/`).
- Where the bridge lives now (link to `packages/desktop/src/ipc/`).
- The contract file (`packages/api/src/bridge.ts`).
- Any follow-ups punted to later (e.g. structured error metadata,
  request logging, etc.).
- Date stamped.

Don't add tutorials or "future work" wishlists; if it's worth doing,
file an issue.

### 9. Final verification

```sh
# Nothing references Express anymore.
git grep -nE "from 'express'|require\\('express'\\)|express\\(\\)" || echo OK
git grep -n 'startServer\\|createApp\\|EventSource\\|/api/' packages/ || echo OK

# All packages typecheck.
pnpm typecheck

# All tests pass.
pnpm test

# A clean build works.
pnpm build

# The app boots and the smoke flow works.
pnpm desktop:dev
```

## Definition of done

- [ ] `packages/api/src/routes/` and `packages/api/src/app.ts` no longer
      exist.
- [ ] `packages/api/package.json` has no `express` or `supertest` entry.
- [ ] `packages/desktop/src/main.ts` has no `startServer` call and no
      `KANBOTS_API_PORT` reference.
- [ ] `git grep -n 'EventSource\\|/api/'` finds no hits in
      `packages/web/src` or `packages/desktop/src`.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm test` green.
- [ ] `pnpm desktop:dev` boots, smoke flow passes (open workspace,
      drag card to In Progress, see decision card, resolve, see agent
      events stream).
- [ ] `README.md` describes the IPC-only architecture.
- [ ] `docs/pivot/COMPLETED.md` exists.

## Sharp edges

- The `attachments` route accepted base64 over HTTP. Stream 1 should
  have added a `Uint8Array` path; Stream 3 should have switched the
  renderer. If you find the base64 path still wired in the handler,
  remove it now (audit `handlers/attachments.ts`).
- Leftover environment variable docs (in `.env.example`, `README.md`,
  CI configs) referencing `KANBOTS_API_PORT` — grep for them and clean
  up.
- `packages/api`'s `tsup.config.ts` may have an `entry` pointing at a
  removed file. Double-check that the build still produces a valid
  `dist/index.js` / `dist/index.d.ts`.
- If `electron-builder` packages bundle the API server somehow, check
  the `extraResources` / `files` config — anything that included
  `packages/api/dist/app.js` is now stale.

## Merge plan

1. Open PR `pivot/04-demolition` → `main`. Title: "Pivot: remove
   Express, IPC-only".
2. PR body: link `docs/pivot/README.md`, paste the smoke-test results,
   list the deleted files, paste before/after `pnpm-lock.yaml` size.
3. Merge after maintainer review. There is no rollback plan that
   doesn't involve `git revert` — make sure the smoke flow is solid
   before pulling the trigger.
