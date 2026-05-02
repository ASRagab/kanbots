# Contributing

The repo is a pnpm monorepo. Each package is independent and built
with `tsup` (or `vite` for `@kanbots/web`).

## Dev workflow

```sh
pnpm install
pnpm desktop:dev     # Vite + tsup --watch + electronmon, three panes
```

That gives you HMR-edit-save-reload across the renderer, the Electron
main process, and the dispatcher. Hard restart only when you change:

- The Electron preload script (`packages/desktop/src/preload.ts`)
- `package.json` `main`/`bin`/`exports`
- Native modules (better-sqlite3) — see "Native modules" below

## Root scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Build every package (tsup / vite) |
| `pnpm dev` | Run every package's `dev` in parallel |
| `pnpm typecheck` | `tsc --noEmit` recursively |
| `pnpm lint` | ESLint over the workspace |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check (CI mode) |
| `pnpm desktop` | Build everything, launch Electron |
| `pnpm desktop:dev` | Hot-reload dev mode |

## Per-package conventions

- **TypeScript only.** ES modules (`"type": "module"`).
- **`tsup`** builds to `dist/` with `.js` (ESM) plus `.d.ts`.
- **`vite`** builds the renderer to `packages/web/dist/`.
- **Public exports** go through each package's `src/index.ts`. Don't
  deep-import across packages — adding to `index.ts` is cheap.

## Where to add things

| Adding… | Goes in |
| --- | --- |
| A new IPC channel | Declare it in `packages/api/src/bridge.ts`. Implement the handler in `packages/api/src/handlers/`. Register it in `packages/desktop/src/ipc/`. |
| A new domain type | `packages/core/src/types.ts` (if cross-package) or a package-local `types.ts`. |
| A new agent CLI | Implement the `AgentCliAdapter` interface in `packages/dispatcher/src/`. Wire it into the dispatcher selector. |
| A new database table | Add a numbered migration in `packages/local-store/src/migrations/`. Add a repo in `packages/local-store/src/repos/`. Export it from `packages/local-store/src/index.ts`. |
| A new MCP tool | Add it to the `KANBOTS_TOOLS` list in `packages/mcp/src/index.ts` and a matching tool-bridge handler in `packages/api/src/tool-bridge.ts`. |
| A new chat provider | Subclass / parameterise `packages/llm/src/adapters/openai-compatible.ts` (most providers); register it in `packages/llm/src/manager.ts`. Don't forget the `ProviderId` enum in `packages/local-store/src/types.ts`. |
| A new UI page | Add to `packages/web/src/pages/`, route through `packages/web/src/App.tsx`. |

## Native modules

`better-sqlite3` is built against Electron's ABI, not Node's. After a
`pnpm install` or any electron version bump:

```sh
pnpm --filter @kanbots/desktop run ensure:native
```

The `dev` and `launch` scripts call this for you, so you usually don't
have to think about it.

## Migrations

Each migration is a file like `0019_project_scope.ts` that exports:

```ts
export default {
  name: '0019_project_scope',
  up(db: Database): void { /* DDL */ },
};
```

The store runner records every applied migration in `schema_migrations`
and skips already-applied ones. Migrations must be **append-only** —
once a number is committed, never edit it; add a new one instead.

## Code style

- ESLint + Prettier are enforced. Run `pnpm format` before committing.
- Imports are auto-organised by Prettier's plugin.
- `console.log` is fine in dispatcher / orchestrator logs (they're
  prefixed with `[autopilot/feature-dev] …` etc.). Don't add console
  noise in the renderer.

## Packaging

Linux only, two targets:

```sh
pnpm package          # → release/kanbots-<version>.AppImage
                      # → release/kanbots-<version>.tar.xz
pnpm package:dir      # unpacked dir (faster for testing)
```

`electron-builder` config is in `packages/desktop/package.json`.
There's nothing for macOS or Windows yet — they work in dev mode but
no packaging recipes are in this repo.

## Layout reminder

```
kanbots/
├── packages/             # pnpm workspaces
├── pnpm-workspace.yaml   # workspace declarations
├── tsconfig.base.json    # shared TS config
├── eslint.config.mjs     # flat ESLint config
└── .prettierrc.json      # formatting
```

Anything that doesn't fit somewhere here probably doesn't belong in the
repo — kanbots stays a single self-contained monorepo on purpose.
