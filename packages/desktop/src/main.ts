import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron';
import {
  createAutopilotManager,
  createCurator,
  createHandlers,
  createSupervisor,
  dispatchChatTool,
  reconcileIssueLabels,
  startToolBridge,
  type AgentSupervisor,
  type AutopilotManager,
  type ChatToolRuntime,
  type DraftIssueFn,
  type Handlers,
  type SentryAnalyzerFn,
  type SentryRuntime,
  type SuggestFeatureFn,
  type ToolBridge,
} from '@kanbots/api';
import { GitHubClient, resolveGitHubToken, type IssueSource } from '@kanbots/core';
import { createComposer, createSentryAnalyzer, createSuggester } from '@kanbots/dispatcher';
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
  cancelCodexLogin,
  CODEX_AUTH_PATH,
  isCodexAuthenticated,
  startCodexLogin,
} from './codex-auth.js';
import { watchDbFile, type DbWatcher } from './db-watcher.js';
import {
  createSubscriptionRegistry,
  type OwnedSubscriptionRegistry,
} from './ipc/subscriptions.js';
import { registerHandlers } from './ipc/register.js';
import { SentryPoller } from './sentry-poller.js';
import {
  decryptToken,
  encryptToken,
  envTokenOverride,
  safeStorageAvailable,
} from './sentry-token.js';
import { hasClaudeCodeCredentials } from './providers-key.js';
import type { ActiveWorkspaceInfo, BootstrapPayload, RecentWorkspace } from './types.js';
import type { AgentRun, AgentRunStatus } from '@kanbots/local-store';

interface ActiveWorkspace {
  repoPath: string;
  config: WorkspaceConfig;
  store: Store;
  source: IssueSource;
  supervisor: AgentSupervisor;
  autopilot: AutopilotManager;
  draftIssue: DraftIssueFn;
  suggestIssue: SuggestFeatureFn;
  analyzeSentryError: SentryAnalyzerFn;
  sentryPoller: SentryPoller;
  subscriptions: OwnedSubscriptionRegistry;
  unregisterHandlers: () => void;
  ownerId: number;
  detachOwnerCleanup: () => void;
  cooldownUnsub: () => void;
  dbWatcher: DbWatcher;
  toolBridge: ToolBridge | null;
  toolBridgeRuntimeDir: string | null;
}

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});

let activeWorkspace: ActiveWorkspace | null = null;
let mainWindow: BrowserWindow | null = null;
const chatWindows = new Set<BrowserWindow>();

function appIconOption(): { icon: string } | Record<string, never> {
  const candidate = join(__dirname, 'icon.png');
  return existsSync(candidate) ? { icon: candidate } : {};
}

function findWebContentsForOwner(ownerId: number | undefined): Electron.WebContents | null {
  if (ownerId === undefined) {
    return mainWindow?.webContents ?? null;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id === ownerId) return win.webContents;
  }
  return mainWindow?.webContents ?? null;
}

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

function stripHouseRules(config: WorkspaceConfig): WorkspaceConfig {
  const { houseRules: _omit, ...rest } = config;
  return rest as WorkspaceConfig;
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

function broadcastIssueChange(): void {
  const sender = mainWindow?.webContents;
  if (!sender || sender.isDestroyed()) return;
  sender.send('issues:changed', {});
}

function wrapNotifyingSource(source: IssueSource): IssueSource {
  const wrapped: IssueSource = {
    listIssues: (opts) => source.listIssues(opts),
    getIssue: (n) => source.getIssue(n),
    listComments: (n) => source.listComments(n),
    addComment: (n, body) => source.addComment(n, body),
    createIssue: async (input) => {
      const r = await source.createIssue(input);
      broadcastIssueChange();
      return r;
    },
    updateIssue: async (n, patch) => {
      const r = await source.updateIssue(n, patch);
      broadcastIssueChange();
      return r;
    },
  };
  if (source.openDraftPR) {
    wrapped.openDraftPR = source.openDraftPR.bind(source);
  }
  return wrapped;
}

function wrapNotifyingSupervisor(supervisor: AgentSupervisor): AgentSupervisor {
  return {
    ...supervisor,
    start: async (input) => {
      const r = await supervisor.start(input);
      broadcastIssueChange();
      return r;
    },
    resume: async (input) => {
      const r = await supervisor.resume(input);
      broadcastIssueChange();
      return r;
    },
    stop: async (id) => {
      const r = await supervisor.stop(id);
      broadcastIssueChange();
      return r;
    },
  };
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
  // Chat windows are bound to the workspace's SQLite db; close them before
  // ripping the workspace down so the renderer stops sending IPC into
  // handlers that are about to disappear.
  if (chatWindows.size > 0) {
    closeAllChatWindows();
  }
  if (!activeWorkspace) return;
  try {
    activeWorkspace.cooldownUnsub();
  } catch {
    // ignore
  }
  try {
    activeWorkspace.detachOwnerCleanup();
  } catch {
    // ignore
  }
  try {
    activeWorkspace.sentryPoller.stop();
  } catch {
    // ignore
  }
  try {
    await activeWorkspace.autopilot.stopAllForShutdown();
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
    activeWorkspace.dbWatcher.stop();
  } catch {
    // ignore
  }
  if (activeWorkspace.toolBridge) {
    try {
      await activeWorkspace.toolBridge.close();
    } catch {
      // ignore
    }
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
  let config = await ensureLocalWorkspace(gitRoot);

  await closeActiveWorkspace();

  const kdir = describeKanbotsDir(gitRoot);
  const store = openStore({ path: kdir.dbPath });

  // Catch external db writes (other process, direct sqlite3 edits) — the
  // notify-wrappers below only cover writes that go through our handlers.
  const dbWatcher = watchDbFile(kdir.dbPath, broadcastIssueChange);

  let source: IssueSource;
  try {
    source = wrapNotifyingSource(await buildSource(config, store));
  } catch (err) {
    dbWatcher.stop();
    store.close();
    throw err;
  }

  const sentryPoller = new SentryPoller({
    store,
    source: source,
    broadcast: broadcastIssueChange,
  });
  const sentryRuntime: SentryRuntime = {
    encryptToken,
    decryptToken,
    envTokenOverride,
    safeStorageAvailable,
    syncNow: () => sentryPoller.runOnce(),
    restartPoller: () => sentryPoller.restart(),
  };

  const providersRuntime = {
    safeStorageAvailable,
    hasClaudeCodeCredentials,
  };

  const containmentEnv = process.env.KANBOTS_CONTAINMENT_MODE;
  const containmentMode: 'off' | 'warn' | 'pause' =
    containmentEnv === 'off' || containmentEnv === 'pause' ? containmentEnv : 'warn';

  const budgetsState = {
    runCostBudgetUsd: config.defaults?.runCostBudgetUsd ?? null,
    sessionCostBudgetUsd: config.defaults?.sessionCostBudgetUsd ?? null,
  };

  const houseRulesState = {
    houseRules: config.houseRules ?? null,
  };

  // Curator runs after every successful agent run on this workspace, distilling
  // events into durable learnings. Cheap by default (Haiku, per-day budget cap)
  // and gracefully no-ops when the run signal isn't `completed_clean`/`promoted`.
  const curator = createCurator({ store, cwd: gitRoot });

  const rawSupervisor = await createSupervisor({
    store,
    repoPath: gitRoot,
    containmentMode,
    defaultRunCostBudgetUsd: () => budgetsState.runCostBudgetUsd,
    houseRules: () => houseRulesState.houseRules,
    onRunStatusChange: async (run) => {
      try {
        await maybeNotifyRunStatus(run, store, source);
      } catch {
        // best-effort: never let notification failures break the supervisor
      }
    },
    onRunComplete: async (run) => {
      // Two best-effort tasks fan out from a successful run:
      //   1. Mirror the run's outcome onto the issue's labels (status:review,
      //      agent:idle).
      //   2. Dispatch the memory-ledger curator so this run feeds future ones.
      // Both run in parallel; failures of either are logged-and-swallowed.
      const labelTask = (async () => {
        const thread = store.threads.findById(run.threadId);
        if (!thread) return;
        const issue = await source.getIssue(thread.issueNumber);
        if (issue.labels.includes('archived')) return;
        const labels = issue.labels.filter(
          (l) => !l.startsWith('status:') && !l.startsWith('agent:'),
        );
        labels.push('status:review', 'agent:idle');
        await source.updateIssue(thread.issueNumber, { labels });
      })().catch(() => {
        // label errors must not crash the supervisor hook
      });
      const curatorTask = curator(run).catch(() => {
        // curator failures must not crash the supervisor hook
      });
      await Promise.allSettled([labelTask, curatorTask]);
    },
  });
  const supervisor = wrapNotifyingSupervisor(rawSupervisor);
  const draftIssue = createComposer({ cwd: gitRoot });
  const suggestIssue = createSuggester({ cwd: gitRoot });
  const analyzeSentryError = createSentryAnalyzer({ cwd: gitRoot });

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
          containmentMode,
        }
      : {
          mode: 'local' as const,
          owner: 'local',
          repo: config.name,
          repoPath: gitRoot,
          authorLogin: config.authorLogin,
          containmentMode,
        };

  const cooldownUnsub = supervisor.subscribeCooldown((state) => {
    const sender = mainWindow?.webContents;
    if (!sender || sender.isDestroyed()) return;
    sender.send('cooldown:changed', state);
  });

  const subscriptions = createSubscriptionRegistry({
    supervisor,
    forward: (payload, ownerId) => {
      // Send to the window that opened the subscription. Falls back to the
      // main window when ownerId is missing (legacy callers) or the original
      // window has gone away.
      const target = findWebContentsForOwner(ownerId);
      if (target && !target.isDestroyed()) {
        target.send('agent-runs:events:data', payload);
      }
      if (payload.kind === 'status') broadcastIssueChange();
    },
  });
  const autopilot = createAutopilotManager({
    store,
    source,
    supervisor,
    suggestIssue,
    repoPath: gitRoot,
    repoConfig: { owner: apiConfig.owner, repo: apiConfig.repo },
    defaultSessionCostBudgetUsd: () => budgetsState.sessionCostBudgetUsd,
    onSessionChange: () => broadcastIssueChange(),
  });
  // The tool-bridge dispatches MCP calls into the same handlers map the
  // IPC bridge serves. Handlers don't exist yet (they reference the bridge
  // via chatTools), so we capture a late-bound slot the bridge consults at
  // request time.
  const handlersHolder: { handlers: Handlers | null } = { handlers: null };
  let toolBridge: ToolBridge | null = null;
  let toolBridgeRuntimeDir: string | null = null;
  let chatTools: ChatToolRuntime | undefined;
  try {
    toolBridge = await startToolBridge({
      handlers: {} as Handlers,
      dispatch: (name, args) => {
        const h = handlersHolder.handlers;
        if (!h) throw new Error('handlers not yet ready');
        return dispatchChatTool(name, args, h);
      },
    });
    toolBridgeRuntimeDir = join(kdir.root, 'mcp-runtime');
    await mkdir(toolBridgeRuntimeDir, { recursive: true });
    const mcpServerEntry = resolveMcpServerEntry();
    if (mcpServerEntry) {
      chatTools = buildChatToolRuntime({
        toolBridge,
        runtimeDir: toolBridgeRuntimeDir,
        mcpServerEntry,
      });
    }
  } catch (err) {
    console.error('[main] tool-bridge bootstrap failed:', err);
    toolBridge = null;
    chatTools = undefined;
  }

  const handlers = createHandlers({
    deps: {
      source,
      store,
      config: apiConfig,
      supervisor,
      draftIssue,
      suggestIssue,
      autopilot,
      analyzeSentryError,
      sentry: sentryRuntime,
      providers: providersRuntime,
      ...(chatTools ? { chatTools } : {}),
      budgets: {
        get: () => ({
          runCostBudgetUsd: budgetsState.runCostBudgetUsd,
          sessionCostBudgetUsd: budgetsState.sessionCostBudgetUsd,
        }),
        set: async (input) => {
          budgetsState.runCostBudgetUsd = input.runCostBudgetUsd;
          budgetsState.sessionCostBudgetUsd = input.sessionCostBudgetUsd;
          const defaults = {
            runCostBudgetUsd: input.runCostBudgetUsd,
            sessionCostBudgetUsd: input.sessionCostBudgetUsd,
          };
          const next: WorkspaceConfig =
            config.mode === 'github'
              ? { ...config, defaults }
              : { ...config, defaults };
          await writeWorkspaceConfig(gitRoot, next);
          config = next;
          if (activeWorkspace && activeWorkspace.repoPath === gitRoot) {
            activeWorkspace.config = next;
          }
        },
      },
      houseRules: {
        get: () => ({ houseRules: houseRulesState.houseRules }),
        set: async (input) => {
          houseRulesState.houseRules = input.houseRules;
          const next: WorkspaceConfig =
            input.houseRules === null
              ? stripHouseRules(config)
              : { ...config, houseRules: input.houseRules };
          await writeWorkspaceConfig(gitRoot, next);
          config = next;
          if (activeWorkspace && activeWorkspace.repoPath === gitRoot) {
            activeWorkspace.config = next;
          }
        },
      },
      revealPath: async (path) => {
        const error = await shell.openPath(path);
        if (error) throw new Error(error);
      },
      onSuggestEvent: (event) => {
        const sender = mainWindow?.webContents;
        if (!sender || sender.isDestroyed()) return;
        sender.send('composer:suggest:event', event);
      },
    },
    subscriptions,
  });
  const unregisterHandlers = registerHandlers(handlers, subscriptions);
  handlersHolder.handlers = handlers;

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
    autopilot,
    draftIssue,
    suggestIssue,
    analyzeSentryError,
    sentryPoller,
    subscriptions,
    unregisterHandlers,
    ownerId,
    detachOwnerCleanup,
    cooldownUnsub,
    dbWatcher,
    toolBridge,
    toolBridgeRuntimeDir,
  };

  sentryPoller.start();

  await ensureGitignoreEntry(gitRoot, '.kanbots/').catch(() => {
    // best-effort
  });

  const displayName = config.mode === 'local' ? config.name : `${config.owner}/${config.repo}`;
  await recordRecent(gitRoot, displayName);

  return { repoPath: gitRoot, config };
}

const NOTIFY_STATUSES = new Set<AgentRunStatus>([
  'awaiting_input',
  'failed',
  'complete',
  'stopped',
]);

function notificationBody(status: AgentRunStatus): string {
  switch (status) {
    case 'awaiting_input':
      return 'Decision needed';
    case 'failed':
      return 'Run failed';
    case 'complete':
      return 'Run complete';
    case 'stopped':
      return 'Run stopped';
    default:
      return status;
  }
}

async function maybeNotifyRunStatus(
  run: AgentRun,
  store: Store,
  source: IssueSource,
): Promise<void> {
  if (!NOTIFY_STATUSES.has(run.status)) return;
  if (!Notification.isSupported()) return;
  if (activeWorkspace?.config.notifyOnRunComplete === false) return;
  // Suppress when the user is already looking at the app — they don't need
  // an OS-level pop-up to tell them what's already on screen.
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;

  const thread = store.threads.findById(run.threadId);
  if (!thread) return;
  let title = `Issue #${thread.issueNumber}`;
  try {
    const issue = await source.getIssue(thread.issueNumber);
    title = `#${thread.issueNumber} ${issue.title}`;
  } catch {
    // fall back to the issue number
  }

  const silent = run.status === 'complete' || run.status === 'stopped';
  const notif = new Notification({
    title,
    body: notificationBody(run.status),
    silent,
  });
  notif.on('click', () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('kanbots:navigate-task', {
        issueNumber: thread.issueNumber,
        runId: run.id,
      });
    }
  });
  notif.show();
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
    // Cheap file/env probe — `codex login status` would shell out and can
    // take seconds. The deeper check still runs via `kanbots:codex-auth-status`
    // and via the providers handler once the renderer queries it.
    const codexAuthed =
      existsSync(CODEX_AUTH_PATH) || Boolean(process.env.OPENAI_API_KEY);
    return {
      workspace: activeWorkspaceInfo(),
      recents,
      claudeAuthed,
      codexAuthed,
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

  ipcMain.handle('kanbots:codex-auth-status', async (): Promise<{ authed: boolean }> => {
    return { authed: await isCodexAuthenticated() };
  });

  ipcMain.handle(
    'kanbots:codex-login-start',
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      return startCodexLogin();
    },
  );

  ipcMain.handle('kanbots:codex-login-cancel', async (): Promise<void> => {
    cancelCodexLogin();
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

  ipcMain.handle('kanbots:window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.close();
      return;
    }
    mainWindow?.close();
  });

  ipcMain.handle(
    'kanbots:open-chat',
    async (
      _event,
      conversationId: number | null,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        if (!activeWorkspace) {
          return { ok: false, error: 'no active workspace' };
        }
        await createChatWindow(conversationId ?? null);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    'kanbots:set-notify-on-run-complete',
    async (_event, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!activeWorkspace) {
        return { ok: false, error: 'no active workspace' };
      }
      try {
        const next: WorkspaceConfig = {
          ...activeWorkspace.config,
          notifyOnRunComplete: enabled,
        };
        await writeWorkspaceConfig(activeWorkspace.repoPath, next);
        activeWorkspace.config = next;
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'kanbots',
    ...appIconOption(),
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

async function createChatWindow(conversationId: number | null): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 880,
    height: 760,
    title: 'kanbots chat',
    ...appIconOption(),
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWindows.add(win);
  win.on('closed', () => {
    chatWindows.delete(win);
    if (activeWorkspace) {
      activeWorkspace.subscriptions.closeAllForOwner(win.webContents.id);
    }
  });

  if (process.env.KANBOTS_OPEN_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // The chat UI lives in the same renderer bundle but mounts a different
  // root view when the URL hash starts with #/chat. Pass the optional
  // conversation id so the window opens straight to it.
  const hash = `#/chat${conversationId !== null ? `/${conversationId}` : ''}`;
  const devUrl = process.env.KANBOTS_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(`${devUrl}${hash}`);
  } else {
    await win.loadFile(join(__dirname, 'web', 'index.html'), { hash });
  }
  return win;
}

function closeAllChatWindows(): void {
  for (const win of [...chatWindows]) {
    try {
      win.close();
    } catch {
      // ignore — closed handler will sweep
    }
  }
  chatWindows.clear();
}

function resolveMcpServerEntry(): string | null {
  // The MCP server ships from `@kanbots/mcp/server`. We resolve the entry
  // through the standard module loader so it works in both dev (pnpm
  // symlinks → packages/mcp/dist/server.js) and a packaged Electron app
  // where node_modules sits beside the desktop bundle.
  try {
    const req = createRequire(__filename);
    const entry = req.resolve('@kanbots/mcp/server');
    return entry;
  } catch {
    return null;
  }
}

function buildChatToolRuntime(args: {
  toolBridge: ToolBridge;
  runtimeDir: string;
  mcpServerEntry: string;
}): ChatToolRuntime {
  const { toolBridge, runtimeDir, mcpServerEntry } = args;
  return {
    prepareForRun: async ({ provider }) => {
      const token = toolBridge.issueToken();
      const env = {
        KANBOTS_TOOL_BRIDGE_URL: toolBridge.baseUrl(),
        KANBOTS_TOOL_BRIDGE_TOKEN: token,
      };
      const mcpServer = {
        command: process.execPath,
        args: [mcpServerEntry],
        env,
      };
      let extraArgs: string[];
      if (provider === 'codex-cli') {
        extraArgs = buildCodexMcpArgs('kanbots', mcpServer);
      } else {
        const configPath = join(
          runtimeDir,
          `mcp-${randomUUID().slice(0, 8)}.json`,
        );
        const config = { mcpServers: { kanbots: mcpServer } };
        await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        extraArgs = ['--mcp-config', configPath];
      }
      return {
        extraArgs,
        env,
        cleanup: () => {
          toolBridge.revokeToken(token);
          // The MCP config file is small; don't bother unlinking — it's
          // inside .kanbots/mcp-runtime which is gitignored and gets
          // garbage-collected on workspace close (the dir is deleted by
          // the workspace bootstrap on next open if you wire it).
        },
      };
    },
  };
}

// codex's `-c key=value` parses the value as TOML, falling back to a raw
// literal if TOML parsing fails. We always emit quoted basic strings + TOML
// arrays so the parser doesn't have to guess.
function buildCodexMcpArgs(
  serverName: string,
  spec: { command: string; args: string[]; env: Record<string, string> },
): string[] {
  const out: string[] = [];
  const base = `mcp_servers.${serverName}`;
  out.push('-c', `${base}.command=${tomlString(spec.command)}`);
  out.push('-c', `${base}.args=[${spec.args.map(tomlString).join(', ')}]`);
  for (const [key, value] of Object.entries(spec.env)) {
    out.push('-c', `${base}.env.${key}=${tomlString(value)}`);
  }
  return out;
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
  // The chat windows have their own lifecycle and may still be running;
  // BrowserWindow.getAllWindows() is empty here only when the user has
  // explicitly closed every window. Drop the workspace so processes don't
  // outlive the UI.
  await closeActiveWorkspace();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  closeAllChatWindows();
  await closeActiveWorkspace();
});
