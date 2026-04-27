import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import {
  createHandlers,
  createSupervisor,
  reconcileIssueLabels,
  type AgentSupervisor,
  type DraftIssueFn,
} from '@kanbots/api';
import { GitHubClient, resolveGitHubToken, type IssueSource } from '@kanbots/core';
import { createComposer } from '@kanbots/dispatcher';
import {
  describeKanbotsDir,
  ensureGitignoreEntry,
  ensureKanbotsDir,
  findGitRoot,
  LocalIssueSource,
  openStore,
  readWorkspaceConfig,
  resolveGitUserName,
  writeWorkspaceConfig,
  type Store,
  type WorkspaceConfig,
} from '@kanbots/local-store';
import {
  cancelClaudeLogin,
  isClaudeAuthenticated,
  startClaudeLogin,
} from './claude-auth.js';
import {
  createSubscriptionRegistry,
  type OwnedSubscriptionRegistry,
} from './ipc/subscriptions.js';
import { registerHandlers } from './ipc/register.js';
import type { ActiveWorkspaceInfo, BootstrapPayload, RecentWorkspace } from './types.js';

interface ActiveWorkspace {
  repoPath: string;
  config: WorkspaceConfig;
  store: Store;
  source: IssueSource;
  supervisor: AgentSupervisor;
  draftIssue: DraftIssueFn;
  subscriptions: OwnedSubscriptionRegistry;
  unregisterHandlers: () => void;
  ownerId: number;
  detachOwnerCleanup: () => void;
}

let activeWorkspace: ActiveWorkspace | null = null;
let mainWindow: BrowserWindow | null = null;

const RECENTS_LIMIT = 20;

function recentsPath(): string {
  return join(app.getPath('userData'), 'workspaces.json');
}

async function readRecents(): Promise<RecentWorkspace[]> {
  try {
    const raw = await readFile(recentsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { recents?: RecentWorkspace[] };
    return Array.isArray(parsed.recents) ? parsed.recents : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

async function writeRecents(list: RecentWorkspace[]): Promise<void> {
  const path = recentsPath();
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify({ recents: list }, null, 2), 'utf-8');
}

async function recordRecent(repoPath: string, displayName: string): Promise<void> {
  const list = await readRecents();
  const filtered = list.filter((r) => r.repoPath !== repoPath);
  filtered.unshift({
    repoPath,
    displayName,
    lastOpenedAt: new Date().toISOString(),
  });
  await writeRecents(filtered.slice(0, RECENTS_LIMIT));
}

async function pruneMissingRecents(): Promise<RecentWorkspace[]> {
  const list = await readRecents();
  const present = list.filter((r) => existsSync(r.repoPath));
  if (present.length !== list.length) await writeRecents(present);
  return present;
}

async function ensureLocalWorkspace(repoPath: string): Promise<WorkspaceConfig> {
  const existing = await readWorkspaceConfig(repoPath);
  if (existing) return existing;
  const authorLogin = await resolveGitUserName(repoPath);
  const config: WorkspaceConfig = {
    mode: 'local',
    name: basename(repoPath),
    authorLogin,
  };
  await writeWorkspaceConfig(repoPath, config);
  return config;
}

async function buildSource(config: WorkspaceConfig, store: Store): Promise<IssueSource> {
  if (config.mode === 'github') {
    const token = await resolveGitHubToken();
    return new GitHubClient({
      owner: config.owner,
      repo: config.repo,
      token,
      cache: store.httpCache,
    });
  }
  return new LocalIssueSource({
    repo: store.localIssues,
    authorLogin: config.authorLogin,
  });
}

async function closeActiveWorkspace(): Promise<void> {
  if (!activeWorkspace) return;
  try {
    activeWorkspace.detachOwnerCleanup();
  } catch {
    // ignore
  }
  try {
    activeWorkspace.subscriptions.closeAllForOwner(activeWorkspace.ownerId);
  } catch {
    // ignore
  }
  try {
    activeWorkspace.unregisterHandlers();
  } catch {
    // ignore
  }
  try {
    activeWorkspace.store.close();
  } catch {
    // ignore
  }
  activeWorkspace = null;
}

async function openWorkspaceInternal(repoPath: string): Promise<ActiveWorkspaceInfo> {
  const gitRoot = await findGitRoot(repoPath);
  if (!gitRoot) {
    throw new Error(
      `${repoPath} is not inside a git repository. Run \`git init\` there and try again.`,
    );
  }

  await ensureKanbotsDir(gitRoot);
  const config = await ensureLocalWorkspace(gitRoot);

  await closeActiveWorkspace();

  const kdir = describeKanbotsDir(gitRoot);
  const store = openStore({ path: kdir.dbPath });

  let source: IssueSource;
  try {
    source = await buildSource(config, store);
  } catch (err) {
    store.close();
    throw err;
  }

  const supervisor = createSupervisor({ store, repoPath: gitRoot });
  const draftIssue = createComposer({ cwd: gitRoot });

  // Demote any in-progress / agent-running labels left over from a previous
  // session. The supervisor sweep above marked stale runs failed; this
  // mirrors that on the issue side so the board doesn't show ghost work.
  const reconcileOwner = config.mode === 'github' ? config.owner : 'local';
  const reconcileRepo = config.mode === 'github' ? config.repo : config.name;
  await reconcileIssueLabels(source, store, reconcileOwner, reconcileRepo).catch(() => {
    // best-effort
  });

  const apiConfig =
    config.mode === 'github'
      ? {
          mode: 'github' as const,
          owner: config.owner,
          repo: config.repo,
          repoPath: gitRoot,
        }
      : {
          mode: 'local' as const,
          owner: 'local',
          repo: config.name,
          repoPath: gitRoot,
          authorLogin: config.authorLogin,
        };

  const subscriptions = createSubscriptionRegistry({
    supervisor,
    forward: (payload) => {
      const sender = mainWindow?.webContents;
      if (!sender || sender.isDestroyed()) return;
      sender.send('agent-runs:events:data', payload);
    },
  });
  const handlers = createHandlers({
    deps: { source, store, config: apiConfig, supervisor, draftIssue },
    subscriptions,
  });
  const unregisterHandlers = registerHandlers(handlers, subscriptions);

  // Tie subscriptions to the renderer that opened them. When the webContents
  // is destroyed (window closed, render process gone) we drop everything to
  // avoid pinning supervisor listeners forever.
  const ownerId = mainWindow?.webContents.id ?? -1;
  const detachOwnerCleanup = (() => {
    const sender = mainWindow?.webContents;
    if (!sender) return () => {};
    const handler = (): void => {
      subscriptions.closeAllForOwner(ownerId);
    };
    sender.on('destroyed', handler);
    return () => {
      try {
        sender.removeListener('destroyed', handler);
      } catch {
        // sender already gone
      }
    };
  })();

  activeWorkspace = {
    repoPath: gitRoot,
    config,
    store,
    source,
    supervisor,
    draftIssue,
    subscriptions,
    unregisterHandlers,
    ownerId,
    detachOwnerCleanup,
  };

  await ensureGitignoreEntry(gitRoot, '.kanbots/').catch(() => {
    // best-effort
  });

  const displayName = config.mode === 'local' ? config.name : `${config.owner}/${config.repo}`;
  await recordRecent(gitRoot, displayName);

  return { repoPath: gitRoot, config };
}

function activeWorkspaceInfo(): ActiveWorkspaceInfo | null {
  if (!activeWorkspace) return null;
  return { repoPath: activeWorkspace.repoPath, config: activeWorkspace.config };
}

function registerIpc(): void {
  ipcMain.handle('kanbots:bootstrap', async (): Promise<BootstrapPayload> => {
    const [recents, claudeAuthed] = await Promise.all([
      pruneMissingRecents(),
      isClaudeAuthenticated(),
    ]);
    return {
      workspace: activeWorkspaceInfo(),
      recents,
      claudeAuthed,
    };
  });

  ipcMain.handle('kanbots:claude-auth-status', async (): Promise<{ authed: boolean }> => {
    return { authed: await isClaudeAuthenticated() };
  });

  ipcMain.handle(
    'kanbots:claude-login-start',
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      return startClaudeLogin();
    },
  );

  ipcMain.handle('kanbots:claude-login-cancel', async (): Promise<void> => {
    cancelClaudeLogin();
  });

  ipcMain.handle('kanbots:pick-folder', async (): Promise<string | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open kanbots workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'kanbots:open-workspace',
    async (_event, repoPath: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await openWorkspaceInternal(repoPath);
        if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('kanbots:close-workspace', async (): Promise<void> => {
    await closeActiveWorkspace();
    if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
  });

  ipcMain.handle('kanbots:recent-workspaces', async (): Promise<RecentWorkspace[]> => {
    return pruneMissingRecents();
  });

  ipcMain.handle('kanbots:window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('kanbots:window-toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('kanbots:window-close', () => {
    mainWindow?.close();
  });
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'kanbots',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.KANBOTS_OPEN_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  const devUrl = process.env.KANBOTS_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    // Renderer is copied into dist/web/ during build; layout: dist/main.cjs → dist/web/index.html.
    await win.loadFile(join(__dirname, 'web', 'index.html'));
  }
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await closeActiveWorkspace();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await closeActiveWorkspace();
});
