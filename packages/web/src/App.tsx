import { useEffect, useMemo, useState } from 'react';
import { useFetch } from './hooks/useFetch.js';
import { useRoute, navigate } from './hooks/useRoute.js';
import { getBridge } from './desktop-bridge.js';
import { useSelection } from './hooks/useSelection.js';
import { useTweaks } from './hooks/useTweaks.js';
import { IssuesProvider, useIssues } from './hooks/useIssues.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { Board } from './pages/Board.js';
import { ProvidersOverlay } from './pages/ProvidersOverlay.js';
import { WorkspacePicker } from './pages/WorkspacePicker.js';
import { api } from './api.js';
import { Window } from './components/shell/Window.js';
import { Shell } from './components/shell/Shell.js';
import { LeftRail } from './components/rail/LeftRail.js';
import { TaskDetailModal } from './components/modals/TaskDetailModal.js';
import { TaskCreateModal } from './components/modals/TaskCreateModal.js';
import { SplitModal } from './components/modals/SplitModal.js';
import { Tray } from './components/tray/Tray.js';
import { Palette } from './components/palette/Palette.js';
import { TweaksPanel } from './components/tweaks/TweaksPanel.js';
import type { ActiveWorkspaceInfo, RecentWorkspace } from './desktop-bridge.js';
import type { Config, Issue } from './types.js';

interface AppProps {
  workspace: ActiveWorkspaceInfo | null;
  initialRecents: RecentWorkspace[];
  hasBridge: boolean;
  initialClaudeAuthed: boolean;
  initialCodexAuthed: boolean;
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
  initialRecents,
  hasBridge,
  initialClaudeAuthed,
  initialCodexAuthed,
}: AppProps) {
  const [providersTick, setProvidersTick] = useState(0);
  const { data: config } = useFetch(workspace ? 'config' : null, () => api.config());
  const { data: providers } = useFetch(
    workspace ? `providers:${providersTick}` : null,
    () => api.getProviders(),
  );

  // Workspace picker still gates first — without a workspace, there's no
  // store to read provider config from.
  if (hasBridge && !workspace) {
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
