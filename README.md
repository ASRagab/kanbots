# kanbots

A desktop kanban for working with Claude Code agents on a project folder.

Open any git repository as a workspace and you get a kanban board for issues
(local, by default), an agent thread per issue, and the ability to start agents
that run in isolated git worktrees with live tool-call streaming, decision
prompts, and a built-in branch preview.

## Status

This is a development build. Launch via the desktop scripts; there is no CLI.

## Packages

| Package | Purpose |
| --- | --- |
| `@kanbots/core` | Domain types, GitHub client, `IssueSource` contract |
| `@kanbots/local-store` | SQLite + migrations, repos, workspace metadata, `LocalIssueSource` |
| `@kanbots/dispatcher` | Agent runtime — spawns and supervises `claude -p`, parses stream-json |
| `@kanbots/api` | Pure handler library + agent supervisor (no HTTP server) |
| `@kanbots/web` | React + Vite UI (renders inside Electron only) |
| `@kanbots/desktop` | Electron shell — workspace picker, IPC bridge, native folder dialog |

## Architecture

The renderer talks to the main process exclusively via Electron IPC
(`window.kanbots.invoke` for commands, `window.kanbots.subscribe` for streams).
There is no HTTP server. The web UI cannot run in a plain browser —
`pnpm desktop:dev` keeps Vite for HMR but Electron is the only client. The
contract for every channel lives in `packages/api/src/bridge.ts` and is
imported type-only by both the renderer and the IPC bridge.

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

A workspace picker opens. Pick any folder that contains a git repository — the
app creates `.kanbots/` (db + config + worktrees dir) on first open and drops
straight into the kanban board.

## License

MIT
