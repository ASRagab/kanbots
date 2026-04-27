# kanbots — phased refactor & feature build plan

> **Note (post-pivot):** the architecture has shifted to IPC-only. The
> Express + SSE plumbing referenced throughout the phases below has been
> replaced by `window.kanbots.invoke` / `subscribe`. The phase content
> still describes the feature roadmap accurately; only the transport
> assumption changed. See `docs/pivot/README.md` (planning) and
> `docs/pivot/COMPLETED.md` (record) for the new contract.

Companion to `design_handoff_kanbots/README.md`. Each phase ships a usable
surface; later phases deepen behavior. Mock first where backend is missing,
wire to live data as soon as the schema lands.

---

## Reading this plan

- **Goal**: what the user/code can do at the end of the phase.
- **Scope**: files, packages, and concrete additions.
- **Mocks → live**: what starts as fixture data and what's already wired.
- **Done when**: small acceptance checklist.
- **Depends on**: other phases (none means "can start today").
- **Risks**: known sharp edges.

Mocks are first-class. Every "real-world" feature in the handoff has a path
from a fixture-backed component → an API endpoint → a live source. Nothing
lands as decoration; every mock is the contract for a follow-up backend task.

---

## Where we are vs. where we need to go

**Already in the codebase (don't rebuild):**
- `@kanbots/api` Express server with issues/messages/agent-runs/cards/diff
  routes and SSE event stream per run.
- `@kanbots/local-store` SQLite + migrations + repos (threads, messages,
  agent_runs, agent_events, cards, local_issues, http_cache, promotions).
- `@kanbots/dispatcher` spawns `claude -p`, parses stream-json into
  `text | tool_use | tool_result | session | decision | result` events.
- `@kanbots/api/agent-runs/supervisor.ts` orchestrates worktree create →
  spawn → persist → decision-aware close → resume.
- `@kanbots/core` `IssueSource` interface; both GitHub and `LocalIssueSource`
  implementations, plus label conventions (`status:*`, `agent:*`).
- `@kanbots/desktop` Electron shell with workspace picker, in-process API,
  recents, native folder dialog (`window.kanbots` bridge).
- `@kanbots/web` minimal: hash-routed Board/IssueDetail/WorkspacePicker,
  `dnd-kit` drag-and-drop between status columns, `AgentRunPanel` with
  embedded ticker + diff preview, `DecisionCard`.

**The delta to the design lives almost entirely in `@kanbots/web`** plus
new lookup/aggregation endpoints in `@kanbots/api` and a small set of
schema additions (cost, model selection, checks state, run-list per thread,
folders/workspaces).

The agent runtime (dispatcher + supervisor + SSE) is in good shape and
covers running/awaiting/complete/failed/stopped already — most "agent-aware"
card affordances can be derived from the current SSE stream + small
extensions, no rewrites required.

---

## Workstream map

```
A. Foundations (visual, no behavior change)
   Phase 0 — Design tokens & typography
   Phase 1 — App shell (titlebar + 3-zone grid)

B. The board surface (where the user lives)
   Phase 2 — Card 2.0 + Column refactor
   Phase 3 — Left rail
   Phase 4 — Inspector dock (replaces standalone IssueDetail)

C. Modals
   Phase 5 — Task Detail modal
   Phase 6 — Task Create modal (live <Card> preview)

D. Cross-cutting surfaces
   Phase 7 — Decision queue tray
   Phase 8 — Command palette (⌘K) + shortcuts
   Phase 9 — Tweaks panel (theme / accent / layout, persisted)

E. Data model & agent depth
   Phase 10 — Workspace-of-folders model
   Phase 11 — Agent intelligence (checks, preview server, /spec mode,
              fork run, reviewer/split, cost & model selection)

F. Hardening
   Phase 12 — Animations, accessibility, performance, end-to-end tests
```

Phases 0 → 9 can ship sequentially with the backend untouched (mocks fill
gaps). Phase 10–11 unlock the "real-world dynamic values" the design
implies. Phase 12 closes loose ends.

---

## Phase 0 — Design tokens & typography

**Goal.** Every CSS variable, font, and base reset from the handoff is
present and themable. Nothing visible changes for the user; the surface
area for every later phase is in place.

**Scope.**
- Replace `packages/web/src/styles.css` head with the `:root[data-theme]`
  oklch token blocks for both `dark` and `paper` (handoff §Tokens).
- Add `@import` for Inter Tight + JetBrains Mono + Instrument Serif (or
  ship as local woff2 to avoid Google Fonts at load time — Electron is
  offline-capable).
- Set `data-theme="dark"` on `<html>` in `main.tsx` until the tweaks
  panel ships.
- Introduce `.mono` and `.serif` utility classes.
- Move existing widget styles into a new `legacy.css` until they're
  rewritten — one file at a time per later phase.
- Set scrollbar styles, body bg gradient, antialiasing.

**Mocks → live.** None (visual).

**Done when.**
- Vite dev shows the dark warm background; no theme flicker on load.
- All design tokens (`--bg`, `--bg-1`, …, `--running`, …, `--add`, `--del`)
  exist and pass an oklch lint (manual eyeball: state pills should read
  at the same visual weight).
- `pnpm typecheck` and `pnpm test` still green.

**Depends on.** Nothing.

**Risks.** Font loading flash. Mitigation: `font-display: swap` and ship
woff2 with the package for the desktop build.

---

## Phase 1 — App shell (titlebar + 3-zone grid)

**Goal.** The window has the macOS chrome and the canonical
`240 / 1fr / 380-480` grid. The middle column scrolls horizontally; rail
and inspector are placeholders. The current Board renders inside the
center column.

**Scope.**
- New `packages/web/src/components/shell/Window.tsx`: title bar with
  `tlights`, crumb, sidebar/inspector toggles. `-webkit-app-region: drag`
  on the bar.
- New `packages/web/src/components/shell/Shell.tsx`: 3-zone grid; props
  `leftRail`, `center`, `inspector`; toggles via React state.
- `App.tsx` becomes a wrapper:
  ```
  <Window>
    <Shell
      leftRail={<RailPlaceholder />}
      center={<Router />}
      inspector={<InspectorPlaceholder selected={…} />}
    />
  </Window>
  ```
- Keep hash routing (`#/`, `#/issue/N`) but issue route now renders inside
  the center column as the *selected* state, not a separate page.
- Inspector visibility toggle persisted in `useState` for now (Phase 9
  promotes to localStorage tweaks).

**Mocks → live.** Rail and inspector are placeholder boxes with section
headers from the design — no data.

**Done when.**
- Window resizes between ~1280px (min) and any larger size without
  layout breakage.
- Title-bar inspector toggle hides/shows the right column; grid becomes
  `240px 1fr` when hidden.
- Existing board still works inside the center column; existing
  drag-and-drop unaffected.

**Depends on.** Phase 0.

**Risks.** The Electron `frame: false` window option may need to be set
to use the custom title bar. Verify the WorkspacePicker still routes
correctly when the bridge isn't present (browser dev mode).

---

## Phase 2 — Card 2.0 + Column refactor

**Goal.** Cards carry the product's DNA: state pill, live ticker on
running, agent question on awaiting, branch + diff stats + check pills,
type tag (FEAT/BUG/IMPL/PR/CHORE), assignee avatars. Columns get the
status-dot header with count and `+`. Selection lifts the inspector.

**Scope.**
- New `packages/web/src/labels.ts` extensions:
  - `priorityFromLabels(labels) → 'p0'|'p1'|'p2'|'p3'|null`
  - `tagFromLabels(labels) → 'FEAT'|'BUG'|'IMPL'|'PR'|'CHORE'|null`
    Conventions: `feat|fix|chore|infra|docs` → upper-cased; PR derived
    from `issue.isPullRequest`.
- `Card.tsx` rewrite (keep `useDraggable`, lose blue chrome):
  - Row 1: tag chip + `#num` + state pill (right-aligned).
  - Row 2: title (Inter Tight 13.5/500, `text-wrap: pretty`).
  - Optional ticker block (`live-ticker` only when `agent === 'running'`
    and we have a `currentTool`).
  - Optional decision block (italic Instrument Serif on the card face
    when `agent === 'blocked'` and a pending decision card exists).
  - Optional progress bar (`running | review`).
  - Footer: branch pill (mono) · `+a -d` · check pills · avatars · age.
  - Left edge stripe (`::before` 2px) for `running | awaiting | review`.
- `Column.tsx` rewrite: header with status-dot glyph, uppercase label,
  count chip, `+` button (Phase 6 wires it).
- `Board.tsx`: 6-column grid (`repeat(6, minmax(280px, 1fr))`), filter
  pills row above the board, toolbar row above that. Click → select +
  inspector update; double-click → open Task Detail modal (stub onClick
  to a `noop` until Phase 5).
- `useSelection()` hook: returns `[selectedNumber, setSelected]`, syncs
  to `#issue=412` URL hash so reload preserves selection.

**Mocks → live.**
- **Live now (already on the wire):** title, number, labels, agent state
  (from `agentFromLabels`), assignees, branch (from active run), `+a -d`
  (need a small endpoint extension — see below), tag.
- **Mocked at first:**
  - **Live ticker line on the card** — derive from the latest `tool_use`
    event of the active run. Phase 4 introduces a board-level subscription
    that maintains a `Map<runId, currentTickerLine>` keyed off the SSE
    stream and exposes `useCurrentTool(runId)`.
  - **Check pills** — return `'idle'` for all three until Phase 11 ships
    the runner. Render a dimmed neutral pill in the meantime.
  - **Progress %** — synthesize from `Math.min(0.95, events.length / 50)`
    until a real heuristic lands (or hide until Phase 11).
  - **Cost stat** — hidden on the card; surfaced in inspector once Phase 11
    lands the cost column.
- **API extension (small):**
  - Add `GET /api/agent-runs/:id/stats` → `{ additions, deletions,
    filesChanged }` derived from the existing diff endpoint (cached 5s).
  - Decorate `Issue` in the API response with `activeRun: { id, branch,
    additions, deletions, filesChanged, currentTool, model } | null` so
    the board doesn't N+1.

**Done when.**
- Each card matches the handoff card spec at every state (`running`,
  `awaiting`, `review`, `failed`, idle).
- A running card shows the latest tool name + truncated arg, and updates
  within ~250ms of the supervisor emitting a `tool_use`.
- A blocked card shows the agent's question on its face in italic serif.
- Selection survives reload via the URL hash.

**Depends on.** Phase 1 (shell), Phase 0 (tokens).

**Risks.** Many cards × always-on SSE could thrash. Mitigation: a single
shared `useBoardAgentStreams()` that opens one EventSource per active
run and fans out via context, not per-card.

---

## Phase 3 — Left rail

**Goal.** Rail lives. Workspace card, folders list, views, live agents,
footer. Click a folder switches the board. Click a live agent focuses
that issue in the inspector.

**Scope.**
- `LeftRail.tsx` with sub-components: `WorkspaceCard`, `FoldersList`,
  `ViewsList`, `LiveAgentsList`, `RailFooter`.
- New `useWorkspace()` hook that returns:
  - `workspace = { id, name, activeAgents }` (mocked at first; real in
    Phase 10)
  - `folders = [{ id, name, path, branch, activeAgents, issues }]`
    (mocked array of one — the current single workspace — until Phase 10)
  - `setCurrentFolder(id)` (no-op until Phase 10)
- Live agents derived from `issues.filter(i => i.agent === 'running' || i.agent === 'awaiting')`.
- Footer: avatar + login (already on the desktop bridge as
  `config.authorLogin` for local mode; from `git config user.name` for
  github mode), `⌘K` opens the palette (Phase 8 stub).

**Mocks → live.**
- **Live now:** active-agent count derived from current issues; current
  user from existing config.
- **Mocked:** folders list (single entry that maps to the open workspace).
- **Live in Phase 10:** real folders array sourced from the workspace
  metadata.

**Done when.**
- Rail renders with the correct workspace card, the open folder marked
  `current`, mocked siblings rendered with disabled-looking state.
- Live agents section pulses for running, amber for awaiting, sage for
  review.
- Clicking a live agent sets the selection and (Phase 4) reveals it in
  the inspector.

**Depends on.** Phase 1.

**Risks.** Mock folders next to the real one can mislead. Treat them as
"coming soon" with a quiet ghost style; don't make them clickable until
they're real.

---

## Phase 4 — Inspector dock (replaces standalone IssueDetail)

**Goal.** Selection drives a docked right column with three tabs
(Thread / Diff / Preview), per-issue meta header, run summary card,
live ticker, decision card, and reply composer. The standalone
`#/issue/N` route falls back to opening the modal (Phase 5) or
auto-selecting in the inspector.

**Scope.**
- `Inspector.tsx` matching `inspector.jsx`:
  - Top bar: `#num · branch | ↗ Expand · Thread · Diff · Preview`.
  - Title block (`#412 + h1`).
  - Meta chips: tag, area labels, opened-by, assignees.
  - **Thread tab:** description, agent run summary card, live ticker,
    decision card, slash-prefixed reply composer with `/spec /review
    /split /test` chips.
  - **Diff tab:** existing `DiffPreview` content reused, restyled to
    match `.diff-block`.
  - **Preview tab:** `<iframe sandbox>` placeholder; live URL in Phase 11.
- Move the existing `AgentRunPanel` content into the Thread tab and
  delete the old `IssueDetail.tsx` page — `#/issue/N` now sets the
  selection and opens the inspector.
- Add `↗ Expand` button → opens Task Detail modal (stub until Phase 5).
- Reply composer: `⌘↵` posts via the existing `postMessage` route; if
  there's an active run, it queues as the next user message after
  decision resolution; otherwise it appends to the thread.

**Mocks → live.**
- **Live now:** run header (status, run id, model, tokens), ticker
  (existing SSE), decision (existing pending card), diff (existing
  endpoint).
- **Mocked at first:** elapsed time (compute from `startedAt` until the
  ticker drives it), cost ($X.XX placeholder until Phase 11), preview
  iframe URL (just the placeholder canvas).

**Done when.**
- Selecting a card populates the inspector within 50ms.
- The active-run ticker scrolls to bottom on each new event.
- Switching tabs preserves position; switching cards resets to Thread.
- The standalone IssueDetail page is gone; deep-link `#/issue/N` opens
  the inspector with #N selected.

**Depends on.** Phases 1, 2.

**Risks.** Thread vs. ticker dual scroll behavior. Cap ticker at last
~150 events with a "view earlier" expander.

---

## Phase 5 — Task Detail modal

**Goal.** Double-click any card (or `↗ Expand`) opens the centered
modal: hero (gradient + state pill), tabs (Overview / Thread / Diff /
Preview / Runs), aside with live run stats, properties, and linked
issues, footer reply.

**Scope.**
- `TaskDetailModal.tsx` matching `task-detail-modal.jsx`.
- Tab content components:
  - `OverviewTab` — description (markdown render via existing
    `markdown` class — keep simple `white-space: pre-wrap` for now,
    swap for `react-markdown` if scope allows), spec checklist, "what
    the agent did just now" (recent tool-call cards from the latest
    run's events).
  - `ThreadTab` — full thread with user/claude bubbles (claude bubble
    `--accent-soft` background); live tool-call card at the tail when
    a run is active, marked `● live`.
  - `DiffTab` — full diff; reuse the inspector renderer.
  - `PreviewTab` — branch preview frame + buttons (Restart dev server,
    Run e2e, Open in browser).
  - `RunsTab` — vertical timeline of runs for this thread/issue.
- Aside blocks `LiveRun` (4-cell grid + check pills),
  `Properties` (status, assignee, priority, folder, worktree, branch,
  base), `Linked` (issues that reference this one).
- Modal mounts to body via portal; Esc + click-scrim close; inner click
  stops propagation.
- `useModal()` for create/detail coordination (only one modal at a time).

**Mocks → live.**
- **Live now:** thread, diff, run stats (model, tokens), description.
- **Live with small additions:**
  - **Runs timeline.** Add `GET /api/issues/:n/runs` →
    `AgentRun[]` for that issue's thread; `agentRuns.listByThread(id)`
    already exists, just expose it.
  - **Linked issues.** Mock until a `links` table lands (defer to
    Phase 11).
  - **Spec checklist.** Mock from the issue body (extract `AC:` block
    if present); store in a new `specs` table later.
  - **Cost.** Hide the field until Phase 11 fills it.

**Done when.**
- Double-clicking any card opens the modal at that issue.
- All five tabs render with no broken state.
- Esc and scrim-click both close; the inner modal does not lose focus
  on inner click.
- The modal's reply footer shares the inspector's submit path (one
  composer logic, two surfaces).

**Depends on.** Phases 0–4.

**Risks.** Modal + inspector both rendering streams could double-bill
the SSE. Centralize subscriptions in a context; both surfaces *read*
from the same `Map<runId, RunStreamState>`.

---

## Phase 6 — Task Create modal (with live `<Card>` preview)

**Goal.** `+ New task` (or `N`) opens the modal. As the user types,
the right aside renders a real `<Card>` with the in-progress form
state. Submit creates the issue and dispatches per-mode.

**Scope.**
- `TaskCreateModal.tsx` matching `task-create-modal.jsx`.
- Form fields: title (autofocus, branch slug preview underneath),
  template chips, description textarea, mode radio cards
  (Spec / Dispatch / Queue), context (folder + base + scope chips),
  agent (assignee + model), checks (tsc/tests/lint/e2e/preview),
  labels (type + priority segmented controls).
- Right aside:
  - "How it'll appear" — section header per mode + a real `<Card>`
    rendered from the form state. **Reuse the actual `Card` component.**
  - "What runs" — numbered step list based on mode + checks.
- Footer split-button:
  - `Spec` mode → `Create & spec`
  - `Dispatch` mode → `Create & dispatch`
  - `Queue` mode → `Create task`
- `⌘↵` submits; Esc closes; replaces the existing `IssueComposer`
  drawer from `Board.tsx` (delete it).
- Submit handler:
  - Creates the issue via `POST /api/issues` with the right `labels`
    (`status:backlog` for queue, `status:todo` for spec, `status:in-progress`
    for dispatch; `priority:p1`, etc.).
  - For `dispatch` and `spec`: create a thread message with the body
    + agent prompt, then `POST /api/issues/:n/agent/start` with
    `prompt`, `appendSystemPrompt` (containing scope hints), and the
    new `model` field (Phase 11 wires model selection to the spawn).
  - For `queue`: just create the issue; no agent call.

**Mocks → live.**
- **Live now:** issue creation, dispatch, label application.
- **Mocked at first:**
  - Folder picker (single value until Phase 10).
  - Base branch picker (single value `main` until Phase 10).
  - `model` field on `POST /agent/start` — supervisor ignores it until
    Phase 11. Pass it through; persist as `agent_runs.model`.
  - Auto-run checks — checked state is stored on the issue (new
    `checks_config` text column) and rendered on the card; the runner
    arrives in Phase 11.
- **Live preview card** — renders immediately; this is the killer feature.

**Done when.**
- The aside `<Card>` updates on every keystroke without re-rendering
  the form.
- Submitting in Spec mode lands the issue in the inProgress lane with
  agent state `awaiting` (after the spec writes its first decision card).
- Submitting in Dispatch mode lands the issue in inProgress with
  agent state `running`, branch + worktree visible on the card within
  ~3s of submit.
- Submitting in Queue mode lands the issue in Backlog with no run.

**Depends on.** Phases 0–4 (Phase 5 unrelated, can ship in parallel).

**Risks.** Slug collisions when two tasks pick the same title-prefix.
Append `-N` suffix server-side; check on dispatch.

---

## Phase 7 — Decision queue tray

**Goal.** Floating bottom-right tray that aggregates **every pending
decision card across every active run**. Resolves with two clicks max.

**Scope.**
- `Tray.tsx` matching `inspector.jsx#Tray`.
- New `GET /api/decisions/pending` →
  ```
  Array<{
    cardId, runId, issueNumber, issueTitle, question, options, ageSec
  }>
  ```
  derived from `cards.findPending()` joined with `messages.agentRunId`,
  joined with `agent_runs.threadId`, joined with `threads.issueNumber`.
- Add `cards.findPending()` query to `CardsRepo`.
- Server-Sent Events: subscribe the tray to a global decisions
  channel (supervisor already emits per-run; add a global emit at
  `decisions:any` for cross-run aggregation).
- Click an option → `POST /api/cards/:id/resolve` (existing route);
  click the tray title → `onJump(issueNumber)` selects the card +
  opens the inspector.

**Mocks → live.** All live from day one (the data is already in the DB).

**Done when.**
- Multiple awaiting agents show one card each in the tray.
- Resolving from the tray transitions the issue from `awaiting` → `running`
  and the tray entry disappears within ~500ms.
- The tray collapses when there are zero pending decisions.

**Depends on.** Phases 0, 2 (cards already exist).

**Risks.** Stale ageSec — render relative time client-side from
`createdAt` so it doesn't drift.

---

## Phase 8 — Command palette (⌘K) + global shortcuts

**Goal.** `⌘K`/`Ctrl+K` toggles a centered overlay. Categories: Quick
actions · Jump to issue · Spawn agent · Split task · Ask Claude.

**Scope.**
- `Palette.tsx` matching `inspector.jsx#Palette`.
- `usePaletteIndex()` builds an in-memory fuzzy index from
  `{ issues, folders, decisions, runs }`.
- `useGlobalShortcuts()` wires:
  - `⌘K` / `Ctrl+K` → open palette (skip when in INPUT/TEXTAREA).
  - `N` → open Task Create modal (skip when in INPUT/TEXTAREA).
  - `Esc` → close any open palette/modal.
  - `D` → resolve top decision in tray (Phase 7 cross-link).
  - `P` → toggle preview tab in inspector.
- "Ask Claude" row uses Instrument Serif italic; on submit, opens the
  Task Create modal pre-filled with the typed text in the description
  field (no agent call yet — the user reviews first).

**Mocks → live.**
- **Live now:** issues, decisions (real DB).
- **Mocked at first:** "Spawn agent on selected issue" if no thread
  yet — first send a one-line message ("start"), then start. Phase 11
  formalizes a one-step "spawn" endpoint.

**Done when.**
- `⌘K` opens the palette, types narrows results, `↵` runs the focused
  row, `Esc` closes.
- Typing `#412` in the input jumps directly to that issue.

**Depends on.** Phases 1, 2.

**Risks.** Shortcuts colliding with browser/Electron defaults. Test in
both dev (browser) and packaged Electron.

---

## Phase 9 — Tweaks panel (theme / accent / layout)

**Goal.** Floating bottom-right window with theme switch (Dark/Paper),
accent hue slider (0–360°), inspector and tray toggles, "Try things"
buttons.

**Scope.**
- `TweaksPanel.tsx` matching `tweaks-panel.jsx`.
- `useTweaks()` hook persisted to `localStorage` under
  `kanbots:tweaks`. Defaults: `{ theme: 'dark', accentHue: 45,
  showInspector: true, showTray: true }`.
- Apply tweaks via CSS variables on `:root` (the handoff already shows
  the JS):
  ```js
  document.documentElement.setAttribute('data-theme', tweaks.theme);
  document.documentElement.style.setProperty(
    '--accent', `oklch(... ${tweaks.accentHue})`
  );
  ```
- Wire the title-bar inspector toggle and the tray toggle to the same
  `useTweaks` so they stay in sync.
- Bind the floating panel's open/close to a small toolbar toggle (or
  a dev-only button until product decides where to put it).

**Mocks → live.** All live (pure UI state).

**Done when.**
- Theme switch flips the entire surface without re-mount.
- Accent hue slider repaints the running pulse, decision tray, primary
  buttons, and selection borders.
- Refresh preserves all tweaks.

**Depends on.** Phase 0 (tokens), Phase 1 (shell toggles).

**Risks.** Paper theme drift — verify all components don't have
hardcoded colors anywhere outside tokens.

---

## Phase 10 — Workspace-of-folders model

**Goal.** A workspace is a named container for one or more folders
(repos). Each folder has its own DB or a workspace-scoped DB tagging
issues by folder. Switching folders updates the board, rail, inspector,
and active-run subscriptions.

**This is the first phase that requires non-trivial backend work.**

**Scope.**
- New table `folders` in the workspace store:
  ```
  id TEXT PRIMARY KEY
  name TEXT
  path TEXT       -- absolute repo path
  default_branch TEXT
  added_at TEXT
  ```
- New table `workspaces` (single row for now, name + id):
  ```
  id TEXT PRIMARY KEY
  name TEXT
  created_at TEXT
  ```
- Migration `0005-workspaces-folders.ts`.
- The store no longer lives at `<repo>/.kanbots/db.sqlite` — promote to
  a workspace-level location: `~/.kanbots/<workspace-id>/db.sqlite`,
  with a per-folder `.kanbots/` directory inside the repo for worktrees.
  (Migration: detect existing single-repo dbs and import into the new
  layout on upgrade.)
- `IssueSource` becomes folder-scoped: each folder has its own
  `LocalIssueSource` or `GitHubIssueSource`. The API gains a
  `folderId` query parameter on `/api/issues`, `/api/issues/:n`, etc.
- Desktop bridge: `openWorkspace(name, folderPaths[])` instead of
  `openWorkspace(repoPath)`. Add `addFolder(workspaceId, repoPath)`,
  `removeFolder(workspaceId, folderId)`.
- Web: `useWorkspace()` becomes real. Folder switch updates the URL
  (`#/folder/<id>` prefix) and the board.

**Mocks → live.** All previous mocks promoted: rail folders list,
workspace card, active-agent counts per folder.

**Done when.**
- Picking two folders in the picker creates one workspace with two
  folders.
- Switching folders in the rail filters the board to that folder's
  issues; agents from the other folder still pulse in the rail.
- Creating an issue from the Task Create modal lands in the currently
  selected folder.

**Depends on.** Phases 1, 3, 6.

**Risks.** Migration of existing single-repo workspaces. Provide a
"convert to workspace" affordance and back up the old db file.

---

## Phase 11 — Agent intelligence

**Goal.** The agent-aware affordances scattered across earlier phases
become real-world dynamic — checks run, previews come online, /spec
gates work, runs accrue cost, model selection respects the user's pick.

This phase is a bundle of independent backend additions; each can land
in any order behind a feature flag.

**11a — Cost & model selection**
- `agent_runs` adds `total_cost_usd REAL`. Migration `0006-cost-model.ts`.
- Supervisor persists `summary.result.totalCostUsd` on close.
- `POST /api/issues/:n/agent/start` accepts `model: 'opus'|'sonnet'`,
  passed to `claude --model <…>`. Persist on `agent_runs.model`.
- Inspector run summary card shows real cost; daily-cost stat in the
  filter row aggregates by `WHERE date(started_at) = date('now')`.

**11b — Checks runner (tsc / tests / lint / e2e)**
- New service `@kanbots/dispatcher/checks.ts`. Pluggable per project:
  `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm e2e`. Defaults
  inferred from `package.json` scripts.
- Run *inside* the run's worktree at user-defined trigger points
  (after each Edit, on stop, on demand).
- Persist results in a new `agent_checks` table:
  `(run_id, kind, status, started_at, finished_at, summary)`.
- New `GET /api/agent-runs/:id/checks` returns the latest per kind.
- Card check pills + inspector check-pill row read from this; SSE
  channel `check:<runId>` pushes updates.

**11c — Branch preview server**
- New service `@kanbots/dispatcher/preview.ts` boots `pnpm dev`
  inside the worktree on a free port (start at 3041, bump on
  collision). Tracks `port`, `pid`, `state` (booting | live | crashed).
- `agent_runs` adds `preview_url TEXT`, `preview_state TEXT`.
- `GET /api/agent-runs/:id/preview` returns current state.
- Preview tab in inspector + detail modal embeds `<iframe>` once
  state is `live`. Restart button kills + respawns.
- Optional auto-start: enabled by the create modal's "branch preview"
  check.

**11d — /spec mode**
- Special spawn that runs an agent with the system prompt set to
  *refine acceptance criteria*; the agent's first action is to emit a
  `kanbots-decision` card to confirm the AC list.
- On approval, the agent writes `.kanbots/specs/<issue>.md` and exits
  `complete`. The Overview tab's spec block reads from this file.
- Mode is just a flag in `POST /agent/start`; supervisor selects the
  system prompt template.

**11e — Reviewer agent / Split / Fork**
- **Reviewer.** `POST /api/issues/:n/agent/start` with
  `template: 'reviewer'` spawns a reviewer agent in a *read-only*
  worktree clone of the PR branch.
- **Split.** New `POST /api/issues/:n/split` accepts a list of sub-tasks;
  creates N child issues linked to the parent, dispatches each on its
  own worktree.
- **Fork.** `POST /api/agent-runs/:id/fork` clones the worktree to a
  sibling path on a new branch and starts a fresh run there. UI: the
  Fork button in the inspector + detail modal.

**11f — Approve & merge / Request changes**
- For PR-mode issues, surface inline buttons that hit
  `POST /api/issues/:n/pr/approve|request-changes`. GitHub mode hits
  the GitHub API; local mode is a no-op (or marks the issue done).

**Mocks → live.** Every mock from earlier phases retires here.

**Done when.**
- A running agent's check pills update live.
- A new task with `preview` checked surfaces a clickable URL in the
  Preview tab within ~30s.
- Spec mode produces a checked-off AC list in the Overview tab.
- Cost shows real dollars per run.

**Depends on.** Phase 10 for folder-scoped agent contexts; otherwise
each sub-phase is independent.

**Risks.** Long-running dev servers leak file handles. Add a janitor
that kills preview procs when their run goes `complete | failed | stopped`.

---

## Phase 12 — Hardening

**Goal.** Ship-quality polish.

**Scope.**
- **Animations.** Add the `modal-in` / `scrim-in` keyframes; cap motion
  in `prefers-reduced-motion`.
- **Accessibility.**
  - Card is a `button[role=link]`; keyboard arrow nav between cards
    in a column, Enter to open, Space to select.
  - All modals: focus trap, focus restore on close, `aria-modal`.
  - Tray and palette: `aria-live="polite"` for new entries.
  - Color-only state distinctions get a parallel icon (the existing
    `CheckBadge` already does this; verify state pills do too).
- **Performance.**
  - Memoize `Card` on `issue.id`, ticker line, check states, selection.
  - Single shared SSE per active run (Phase 4 contract).
  - Virtualize columns when > 50 cards each (only the inProgress lane
    realistically grows that big — guard with `react-window`).
- **End-to-end.**
  - Playwright: open workspace → create dispatch task → see card flip
    to running → resolve a decision from the tray → see card flip back
    to running → see check pills go pass.
  - Vitest: per-component unit tests already cover Card/Column/etc.
- **Telemetry hooks.** Optional: emit `kanbots:event` JSON lines to a
  log file for tweaks/perf debugging in dev.

**Done when.**
- Lighthouse-equivalent run on the desktop dev mode reports no a11y
  violations.
- A 200-card column scrolls at 60fps on a baseline laptop.
- The Playwright happy path runs in CI under 90s.

---

## Cross-cutting workstreams

These run in parallel with the phases, owned by anyone touching the
code in scope.

### Type strictness
- Promote `unknown` payloads in `AgentEvent` to discriminated unions
  (`TextEvent | ToolUseEvent | …`) once the design needs richer
  per-event rendering (Phase 4+).
- Add `tag` and `priority` to `Issue` decoration in the API response so
  the web doesn't re-derive them everywhere.

### Testing strategy
- Component-level: a Storybook (or a lightweight `dev-fixtures.tsx`
  page) that mounts every state variation of `Card`, `Column`,
  `Inspector`, `TaskDetailModal`, `TaskCreateModal` against the
  fixture data from `design_handoff_kanbots/source/data.js`. Lift that
  fixture into `packages/web/src/test-fixtures.ts` and use it both in
  unit tests and the dev playground.
- API-level: keep the existing supertest fixture pattern; add cases for
  the new endpoints (decisions/pending, runs by issue, checks).

### Git & branch hygiene
- Each phase = one PR (or one merge train per sub-phase for Phase 11).
- Phase 0–1 are visual-only; ship behind no flag (the surface is
  inert).
- Phase 2+ ship behind `KANBOTS_NEW_UI=1` env until Phase 9 lands and
  we cut over the default. The old `IssueDetail` page stays available
  via the env flag for one release cycle as a kill-switch.

### Deletion plan
After Phase 9 lands the new shell as default:
- Delete `packages/web/src/pages/IssueDetail.tsx`.
- Delete `packages/web/src/components/Composer.tsx` (folded into
  inspector composer + create modal).
- Delete `packages/web/src/components/IssueComposer.tsx` (replaced by
  Task Create modal).
- Trim `styles.css` of all light-theme legacy rules; keep paper-theme
  variant from Phase 9.

---

## What we are deliberately not building

(Mirrors the design handoff's out-of-scope list; restated for clarity.)

- Mobile / narrow viewport. Min-width is ~1280px (the design's `.stage`
  enforces this).
- Auth / multi-user. The Electron shell is single-user; identity is
  the local git user.
- Real-time collaboration. Two users on the same workspace is undefined
  behavior.
- A separate web-only deployment. The web package can be served
  standalone for dev (Vite at :5173), but the production target is the
  Electron desktop app.

---

## Quick sanity check before starting

Run these once to confirm the assumptions in this plan:

```sh
# baseline tests
pnpm install && pnpm typecheck && pnpm test

# desktop boots and surfaces a workspace picker
pnpm desktop:dev
```

If all three pass, Phase 0 is the right starting point — drop in the
oklch tokens and the Inter Tight import, and the rest of the plan
unfolds from there.
