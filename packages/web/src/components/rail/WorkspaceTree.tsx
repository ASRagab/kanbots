import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getBridge } from '../../desktop-bridge.js';

/**
 * VSCode-style file tree for the active local repo (cloud-bound or
 * legacy local workspace). Lazy-loads folder contents on expand,
 * caches them per-path, and badges files touched by any active git
 * worktree (committed via the worktree-status sweep) or by an in-
 * flight agent run (committed via the live workspace:touched event
 * stream — flips a file's badge the instant a tool_use Edit fires,
 * before the next git poll).
 *
 * "Touched" is intentionally inclusive — once a file has been
 * touched, it stays badged until the underlying worktree poll says
 * otherwise. That matches what a developer expects: an Edit-tool
 * call counts, even if the agent paused before saving.
 */

type EntryType = 'file' | 'dir';

interface Entry {
  name: string;
  path: string;
  type: EntryType;
}

type StatusCode = 'M' | 'A' | 'D' | 'R' | '??' | 'U';

interface WorktreeStatus {
  files: Record<string, { status: StatusCode; worktrees: string[] }>;
  worktrees: string[];
}

interface TouchedMeta {
  status: StatusCode;
  /** Distinct worktrees the renderer knows about. */
  worktrees: string[];
  /** True once a live tool_use has fired for this path this session. */
  live: boolean;
}

type ChildrenCache = Record<string, Entry[]>;

interface TreeState {
  expanded: Set<string>;
  children: ChildrenCache;
  loading: Set<string>;
}

type TreeAction =
  | { kind: 'load-start'; path: string }
  | { kind: 'load-done'; path: string; entries: Entry[] }
  | { kind: 'toggle'; path: string }
  | { kind: 'reset' };

function reducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.kind) {
    case 'load-start': {
      const next = new Set(state.loading);
      next.add(action.path);
      return { ...state, loading: next };
    }
    case 'load-done': {
      const loading = new Set(state.loading);
      loading.delete(action.path);
      return {
        ...state,
        loading,
        children: { ...state.children, [action.path]: action.entries },
      };
    }
    case 'toggle': {
      const expanded = new Set(state.expanded);
      if (expanded.has(action.path)) expanded.delete(action.path);
      else expanded.add(action.path);
      return { ...state, expanded };
    }
    case 'reset':
      return { expanded: new Set([]), children: {}, loading: new Set() };
  }
}

const POLL_INTERVAL_MS = 8_000;

/**
 * Strip a worktree-status key down to the path the tree's entries
 * use. Git porcelain output can include quoted UTF-8 wrappers
 * ("path"); the read-dir IPC emits plain forward-slash relative
 * paths. We just trim outer quotes — anything else stays as-is so
 * the comparison stays explicit.
 */
function normaliseStatusKey(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function buildTouchedMap(
  remote: WorktreeStatus,
  live: ReadonlyMap<string, { worktreePath: string | null }>,
): Map<string, TouchedMeta> {
  const out = new Map<string, TouchedMeta>();
  for (const [rawKey, info] of Object.entries(remote.files)) {
    const key = normaliseStatusKey(rawKey);
    out.set(key, { status: info.status, worktrees: info.worktrees, live: false });
  }
  for (const [key, info] of live) {
    const existing = out.get(key);
    if (existing) {
      existing.live = true;
      if (info.worktreePath !== null && !existing.worktrees.includes(info.worktreePath)) {
        existing.worktrees.push(info.worktreePath);
      }
    } else {
      out.set(key, {
        status: 'M',
        worktrees: info.worktreePath !== null ? [info.worktreePath] : [],
        live: true,
      });
    }
  }
  return out;
}

/**
 * Count how many descendants of `dirPath` are in the touched map.
 * The map is small (typically <100), so the linear scan is fine.
 */
function countTouchedDescendants(
  touched: ReadonlyMap<string, TouchedMeta>,
  dirPath: string,
): number {
  const prefix = dirPath.length === 0 ? '' : `${dirPath}/`;
  let n = 0;
  for (const key of touched.keys()) {
    if (key.startsWith(prefix)) n += 1;
  }
  return n;
}

function badgeChar(status: StatusCode): string {
  switch (status) {
    case '??':
      return 'U';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'U':
      return '!';
    default:
      return 'M';
  }
}

interface RowProps {
  entry: Entry;
  depth: number;
  state: TreeState;
  touched: ReadonlyMap<string, TouchedMeta>;
  rootPath: string;
  dispatch: React.Dispatch<TreeAction>;
}

function TreeRow({ entry, depth, state, touched, rootPath, dispatch }: RowProps) {
  const expanded = state.expanded.has(entry.path);
  const loading = state.loading.has(entry.path);
  const children = state.children[entry.path];

  useEffect(() => {
    if (entry.type !== 'dir') return;
    if (!expanded) return;
    if (children !== undefined) return;
    if (loading) return;
    dispatch({ kind: 'load-start', path: entry.path });
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .workspaceReadDir({ rootPath, relPath: entry.path })
      .then((entries) => dispatch({ kind: 'load-done', path: entry.path, entries }))
      .catch(() => dispatch({ kind: 'load-done', path: entry.path, entries: [] }));
  }, [entry.type, entry.path, expanded, children, loading, dispatch, rootPath]);

  const touchedForThis = touched.get(entry.path);
  const descCount = entry.type === 'dir' ? countTouchedDescendants(touched, entry.path) : 0;

  const indent = depth * 12 + 8;

  return (
    <>
      <button
        type="button"
        className={
          `kb-tree-row${touchedForThis ? ' is-touched' : ''}` +
          (entry.type === 'dir' ? ' is-dir' : ' is-file') +
          (touchedForThis?.live ? ' is-live' : '') +
          (touchedForThis
            ? ` is-status-${badgeChar(touchedForThis.status).toLowerCase()}`
            : entry.type === 'dir' && descCount > 0
              ? ' has-dirty-descendants'
              : '')
        }
        style={{ paddingLeft: indent }}
        onClick={() => {
          if (entry.type === 'dir') dispatch({ kind: 'toggle', path: entry.path });
        }}
        title={
          touchedForThis
            ? `${entry.path} — ${touchedForThis.live ? 'editing now' : 'modified'} in ${
                touchedForThis.worktrees.length || 1
              } worktree${touchedForThis.worktrees.length === 1 ? '' : 's'}`
            : entry.path
        }
        aria-expanded={entry.type === 'dir' ? expanded : undefined}
      >
        <span className="kb-tree-caret" aria-hidden>
          {entry.type === 'dir' ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span className="kb-tree-icon" aria-hidden>
          {entry.type === 'dir' ? (expanded ? '📂' : '📁') : '📄'}
        </span>
        <span className="kb-tree-name">{entry.name}</span>
        {touchedForThis ? (
          <span
            className={`kb-tree-badge kb-tree-badge-${badgeChar(touchedForThis.status).toLowerCase()}${touchedForThis.live ? ' is-live' : ''}`}
            aria-label={`status ${touchedForThis.status}`}
          >
            {badgeChar(touchedForThis.status)}
          </span>
        ) : entry.type === 'dir' && descCount > 0 ? (
          <span
            className="kb-tree-badge kb-tree-badge-count"
            aria-label={`${descCount} touched descendants`}
          >
            {descCount}
          </span>
        ) : null}
      </button>
      {entry.type === 'dir' && expanded ? (
        loading && children === undefined ? (
          <div className="kb-tree-loading" style={{ paddingLeft: indent + 16 }}>
            loading…
          </div>
        ) : (
          (children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              state={state}
              touched={touched}
              rootPath={rootPath}
              dispatch={dispatch}
            />
          ))
        )
      ) : null}
    </>
  );
}

export interface WorkspaceTreeProps {
  /** Friendly name shown above the tree (e.g. project name + branch). */
  header?: { name: string; subtitle?: string };
}

export function WorkspaceTree({ header }: WorkspaceTreeProps) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatus>({
    files: {},
    worktrees: [],
  });
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    expanded: new Set<string>(['']),
    children: {} as ChildrenCache,
    loading: new Set<string>(),
  }));
  const liveTouchedRef = useRef(
    new Map<string, { worktreePath: string | null }>(),
  );
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // 1. Resolve the active repo root once, plus a periodic re-check so
  //    closing a workspace clears the tree without a renderer reload.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const { repoRoot } = await bridge!.workspaceCurrentRoot();
        if (cancelled) return;
        setRootPath((prev) => {
          if (prev === repoRoot) return prev;
          dispatch({ kind: 'reset' });
          return repoRoot;
        });
      } catch {
        // ignore
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // 2. Load the root listing.
  useEffect(() => {
    if (rootPath === null) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    dispatch({ kind: 'load-start', path: '' });
    void bridge
      .workspaceReadDir({ rootPath, relPath: '' })
      .then((entries) => {
        if (!cancelled) dispatch({ kind: 'load-done', path: '', entries });
      })
      .catch(() => {
        if (!cancelled) dispatch({ kind: 'load-done', path: '', entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // 3. Poll worktree status.
  useEffect(() => {
    if (rootPath === null) {
      setWorktreeStatus({ files: {}, worktrees: [] });
      return;
    }
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const status = await bridge!.workspaceWorktreeStatus({ rootPath: rootPath as string });
        if (!cancelled) setWorktreeStatus(status);
      } catch {
        // ignore
      }
    }
    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rootPath]);

  // 4. Subscribe to live "touched" broadcasts.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    const unsubscribe = bridge.workspaceSubscribeTouched(
      ({ filePath, worktreePath }) => {
        // Convert absolute paths into repo-relative ones if possible —
        // the renderer doesn't always know `rootPath` is a prefix.
        let key = filePath;
        if (rootPath !== null && filePath.startsWith(rootPath)) {
          key = filePath.slice(rootPath.length).replace(/^[\\/]+/, '');
        }
        key = key.replace(/\\/g, '/');
        liveTouchedRef.current.set(key, { worktreePath });
        forceRender();
      },
    );
    return () => unsubscribe();
  }, [rootPath]);

  const touched = useMemo(
    () => buildTouchedMap(worktreeStatus, liveTouchedRef.current),
    // `liveTouchedRef.current` is intentionally referenced for the
    // dependency tracker — we rebuild on every force-render too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [worktreeStatus, liveTouchedRef.current.size],
  );

  const rootEntries = state.children[''];

  const handleHeaderRefresh = useCallback(() => {
    const bridge = getBridge();
    if (!bridge || rootPath === null) return;
    void bridge
      .workspaceWorktreeStatus({ rootPath })
      .then(setWorktreeStatus)
      .catch(() => undefined);
  }, [rootPath]);

  if (rootPath === null) {
    return (
      <div className="kb-tree-empty" role="status">
        No local repo bound. Open Cloud Settings → Bind local repo to see the file
        tree here.
      </div>
    );
  }

  return (
    <div className="kb-tree" role="tree" aria-label="Workspace files">
      {header ? (
        <button
          type="button"
          className="kb-tree-header"
          onClick={handleHeaderRefresh}
          title="Refresh worktree status"
        >
          <span className="kb-tree-header-name">{header.name}</span>
          {header.subtitle ? (
            <span className="kb-tree-header-sub">{header.subtitle}</span>
          ) : null}
        </button>
      ) : null}
      {rootEntries === undefined ? (
        <div className="kb-tree-loading" style={{ paddingLeft: 8 }}>
          loading…
        </div>
      ) : rootEntries.length === 0 ? (
        <div className="kb-tree-empty">Empty directory.</div>
      ) : (
        rootEntries.map((entry) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={0}
            state={state}
            touched={touched}
            rootPath={rootPath}
            dispatch={dispatch}
          />
        ))
      )}
    </div>
  );
}
