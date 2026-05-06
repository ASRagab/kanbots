import { useEffect, useMemo, useState } from 'react';
import { useFetch } from './hooks/useFetch.js';
import { useRoute, navigate } from './hooks/useRoute.js';
import { getBridge } from './desktop-bridge.js';
import { useSelection } from './hooks/useSelection.js';
import { useTweaks } from './hooks/useTweaks.js';
import { IssuesProvider, useIssues } from './hooks/useIssues.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { Board } from './pages/Board.js';
import { CloudWorkspacePicker } from './pages/CloudWorkspacePicker.js';
import { ProvidersOverlay } from './pages/ProvidersOverlay.js';
import { WorkspacePicker } from './pages/WorkspacePicker.js';
import { api } from './api.js';
import { Window } from './components/shell/Window.js';
import { Shell } from './components/shell/Shell.js';
import { LeftRail } from './components/rail/LeftRail.js';
import { CloudFirstRunPrompt } from './components/CloudFirstRunPrompt.js';
import { TaskDetailModal } from './components/modals/TaskDetailModal.js';
import { TaskCreateModal } from './components/modals/TaskCreateModal.js';
import { SplitModal } from './components/modals/SplitModal.js';
import { Tray } from './components/tray/Tray.js';
import { Palette } from './components/palette/Palette.js';
import { TweaksPanel } from './components/tweaks/TweaksPanel.js';
import type {
  ActiveCloudWorkspaceInfo,
  ActiveWorkspaceInfo,
  RecentCloudWorkspace,
  RecentWorkspace,
} from './desktop-bridge.js';
import type { Config, Issue } from './types.js';

interface AppProps {
  workspace: ActiveWorkspaceInfo | null;
  cloudWorkspace: ActiveCloudWorkspaceInfo | null;
  initialRecents: RecentWorkspace[];
  initialCloudRecents: RecentCloudWorkspace[];
  hasBridge: boolean;
  initialClaudeAuthed: boolean;
  initialCodexAuthed: boolean;
  initialCloudAuthed: boolean;
  initialCloudPromptDismissed: boolean;
}

function describeFolder(config: Config | null): string {
  if (!config) return '…';
  if (config.mode === 'local') return config.repo;
  return `${config.owner}/${config.repo}`;
}

function ShellHost({
  config,
  workspace,
}: {
  config: Config | null;
  workspace: ActiveWorkspaceInfo | null;
}) {
  const [notifyOnRunComplete, setNotifyOnRunCompleteState] = useState<boolean>(
    workspace?.config.notifyOnRunComplete !== false,
  );

  useEffect(() => {
    setNotifyOnRunCompleteState(workspace?.config.notifyOnRunComplete !== false);
  }, [workspace?.config.notifyOnRunComplete]);

  const setNotifyOnRunComplete = (enabled: boolean): void => {
    setNotifyOnRunCompleteState(enabled);
    const bridge = getBridge();
    if (bridge?.setNotifyOnRunComplete) {
      void bridge.setNotifyOnRunComplete(enabled);
    }
  };

  const route = useRoute();
  const [selectedNumber, setSelectedNumber] = useSelection();
  const { tweaks, set: setTweak, reset: resetTweaks } = useTweaks();
  const [detailIssueNumber, setDetailIssueNumber] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialDescription, setCreateInitialDescription] = useState<string>('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [splitTargetNumber, setSplitTargetNumber] = useState<number | null>(null);
  const { mutate, issues } = useIssues();

  useEffect(() => {
    document.documentElement.dataset.kbRail = tweaks.showRail ? 'on' : 'off';
  }, [tweaks.showRail]);

  useEffect(() => {
    if (route.name === 'issue' && selectedNumber !== route.number) {
      setSelectedNumber(route.number);
    }
  }, [route, selectedNumber, setSelectedNumber]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.subscribe('kanbots:navigate-task', (payload) => {
      const issueNumber =
        typeof payload === 'object' && payload !== null && 'issueNumber' in payload
          ? (payload as { issueNumber: unknown }).issueNumber
          : null;
      if (typeof issueNumber !== 'number') return;
      navigate({ name: 'issue', number: issueNumber });
      setSelectedNumber(issueNumber);
      setDetailIssueNumber(issueNumber);
    });
  }, [setSelectedNumber]);

  const shortcutHandlers = useMemo(
    () => ({
      onPalette: () => setPaletteOpen((v) => !v),
      onCreate: () => {
        setCreateInitialDescription('');
        setCreateOpen(true);
      },
      onClosePopovers: () => {
        setPaletteOpen(false);
        setDetailIssueNumber(null);
        setCreateOpen(false);
        setTweaksOpen(false);
        setSplitTargetNumber(null);
      },
      onResolveTopDecision: () => {
        const blocked = issues.find((i) => i.agent === 'blocked');
        if (blocked) setSelectedNumber(blocked.number);
      },
      onTogglePreview: () => {
        if (selectedNumber !== null) setDetailIssueNumber(selectedNumber);
      },
    }),
    [issues, selectedNumber, setSelectedNumber],
  );
  useGlobalShortcuts(shortcutHandlers);

  function openDetail(n: number): void {
    setDetailIssueNumber(n);
  }
  function closeDetail(): void {
    setDetailIssueNumber(null);
  }
  function openCreate(initialDescription?: string): void {
    setCreateInitialDescription(initialDescription ?? '');
    setCreateOpen(true);
  }
  function handleCreated(issue: Issue): void {
    mutate((prev) => [issue, ...(prev ?? [])]);
    setSelectedNumber(issue.number);
  }

  const reviewReady = issues.find((i) => i.agent === 'review') ?? null;
  const pausedAgent = issues.find((i) => i.agent === 'blocked') ?? null;

  return (
    <>
      <Window
        workspaceName="kanbots workspace"
        folderName={describeFolder(config)}
        branch="main"
        showRail={tweaks.showRail}
        onToggleRail={() => setTweak('showRail', !tweaks.showRail)}
        tweaksOpen={tweaksOpen}
        onToggleTweaks={() => setTweaksOpen((v) => !v)}
      >
        <Shell
          rail={
            tweaks.showRail ? (
              <LeftRail
                selectedNumber={selectedNumber}
                onSelectIssue={setSelectedNumber}
                onOpenPalette={() => setPaletteOpen(true)}
              />
            ) : null
          }
          center={
            <Board
              onOpenDetail={openDetail}
              onOpenCreate={() => openCreate()}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          }
        />
      </Window>
      {detailIssueNumber !== null ? (
        <TaskDetailModal issueNumber={detailIssueNumber} onClose={closeDetail} />
      ) : null}
      {createOpen ? (
        <TaskCreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          initialDescription={createInitialDescription}
        />
      ) : null}
      {tweaks.showTray ? <Tray onJump={(n) => setSelectedNumber(n)} /> : null}
      <Palette
        open={paletteOpen}
        selectedNumber={selectedNumber}
        onClose={() => setPaletteOpen(false)}
        onJump={(n) => setSelectedNumber(n)}
        onOpenCreate={openCreate}
        onOpenDetail={openDetail}
        onOpenSplit={(n) => setSplitTargetNumber(n)}
        onResolveTopDecision={shortcutHandlers.onResolveTopDecision}
      />
      {splitTargetNumber !== null ? (
        <SplitModal
          parentNumber={splitTargetNumber}
          parentTitle={
            issues.find((i) => i.number === splitTargetNumber)?.title ?? `#${splitTargetNumber}`
          }
          onClose={() => setSplitTargetNumber(null)}
        />
      ) : null}
      {tweaksOpen ? (
        <TweaksPanel
          tweaks={tweaks}
          onSet={setTweak}
          onReset={resetTweaks}
          onClose={() => setTweaksOpen(false)}
          onOpenPalette={() => {
            setTweaksOpen(false);
            setPaletteOpen(true);
          }}
          {...(pausedAgent
            ? { onFocusPaused: () => setSelectedNumber(pausedAgent.number) }
            : {})}
          {...(reviewReady
            ? { onFocusReview: () => setSelectedNumber(reviewReady.number) }
            : {})}
          notifyOnRunComplete={notifyOnRunComplete}
          {...(getBridge()
            ? { onSetNotifyOnRunComplete: setNotifyOnRunComplete }
            : {})}
        />
      ) : null}
    </>
  );
}

export function App({
  workspace,
  cloudWorkspace,
  initialRecents,
  initialCloudRecents,
  hasBridge,
  initialClaudeAuthed,
  initialCodexAuthed,
  initialCloudAuthed,
  initialCloudPromptDismissed,
}: AppProps) {
  const [providersTick, setProvidersTick] = useState(0);
  const [cloudPromptDone, setCloudPromptDone] = useState<boolean>(
    initialCloudAuthed || initialCloudPromptDismissed,
  );
  const [cloudAuthed, setCloudAuthed] = useState<boolean>(initialCloudAuthed);
  const [forceLocalPicker, setForceLocalPicker] = useState(false);
  const { data: config } = useFetch(workspace ? 'config' : null, () => api.config());
  const { data: providers } = useFetch(
    workspace ? `providers:${providersTick}` : null,
    () => api.getProviders(),
  );

  // Cloud first-run prompt: highest-priority overlay. Sits in front of the
  // workspace picker so the user makes the local-vs-cloud choice before
  // anything else. Dismissal is sticky (persisted to disk) so this only
  // shows once. Browserless dev shells skip the gate entirely.
  if (hasBridge && !cloudPromptDone) {
    return (
      <CloudFirstRunPrompt
        onDismissed={() => setCloudPromptDone(true)}
        onSignedIn={() => {
          setCloudAuthed(true);
          setCloudPromptDone(true);
        }}
      />
    );
  }

  // Cloud-mode placeholder while P3 wires the cloud-backed Board.
  // Shows the active project so the user knows the workspace switched.
  if (hasBridge && cloudWorkspace !== null) {
    return <CloudWorkspaceShell info={cloudWorkspace} />;
  }

  // No workspace selected. If the user is signed in to cloud (and hasn't
  // explicitly asked for local), show the cloud picker; otherwise the
  // local one.
  if (hasBridge && !workspace) {
    if (cloudAuthed && !forceLocalPicker) {
      return (
        <CloudWorkspacePicker
          initialRecents={initialCloudRecents}
          onPickLocal={() => setForceLocalPicker(true)}
          onOpened={() => window.location.reload()}
        />
      );
    }
    return (
      <WorkspacePicker initialRecents={initialRecents} onOpened={() => window.location.reload()} />
    );
  }

  // Providers gate. The overlay is non-dismissible — the kanban renders
  // behind it but can't be interacted with until at least one provider is
  // configured. The initial auth flags are surfaced so a fresh install with
  // either Claude Code or codex-cli already signed in unblocks immediately
  // before the providers query resolves.
  const anyConfigured =
    providers?.anyConfigured ??
    (hasBridge ? initialClaudeAuthed || initialCodexAuthed : true);

  if (hasBridge && !anyConfigured) {
    return (
      <IssuesProvider>
        <ShellHost config={config ?? null} workspace={workspace} />
        <ProvidersOverlay
          reason={(providers?.providers ?? []).some((p) => p.lastError) ? 'all-failed' : 'none'}
          onConfigured={() => setProvidersTick((t) => t + 1)}
        />
      </IssuesProvider>
    );
  }

  return (
    <IssuesProvider>
      <ShellHost config={config ?? null} workspace={workspace} />
    </IssuesProvider>
  );
}

/**
 * Placeholder for the cloud-mode shell. P3 replaces this with the
 * actual cloud-backed Board, comments, and run streaming. For now
 * it just confirms the workspace switched and offers a way back to
 * the picker so the user isn't trapped.
 */
function CloudWorkspaceShell({ info }: { info: ActiveCloudWorkspaceInfo }) {
  const [closing, setClosing] = useState(false);

  async function close(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) return;
    setClosing(true);
    await bridge.closeCloudWorkspace();
    window.location.reload();
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 32,
        gap: 16,
        textAlign: 'center',
        color: 'var(--ink)',
      }}
    >
      <h1 style={{ fontSize: 24, margin: 0 }}>{info.projectDisplayName}</h1>
      <p style={{ color: 'var(--ink-2)', margin: 0 }}>
        {info.orgDisplayName} · cloud project
      </p>
      <p style={{ color: 'var(--ink-3)', maxWidth: 480, fontSize: 13 }}>
        The cloud-backed board lands in P3. For now, this confirms the workspace is
        connected to <code>{info.orgSlug}/{info.projectSlug}</code>. Cards, comments, and
        run streaming will render here.
      </p>
      <button
        type="button"
        className="kb-btn ghost"
        onClick={() => void close()}
        disabled={closing}
      >
        {closing ? 'Closing…' : 'Switch workspace'}
      </button>
    </div>
  );
}
