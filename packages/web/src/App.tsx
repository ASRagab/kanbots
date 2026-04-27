import { useEffect, useMemo, useState } from 'react';
import { useFetch } from './hooks/useFetch.js';
import { useRoute } from './hooks/useRoute.js';
import { useSelection } from './hooks/useSelection.js';
import { useTweaks } from './hooks/useTweaks.js';
import { IssuesProvider, useIssues } from './hooks/useIssues.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { Board } from './pages/Board.js';
import { ClaudeLoginGate } from './pages/ClaudeLoginGate.js';
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
}

function describeFolder(config: Config | null): string {
  if (!config) return '…';
  if (config.mode === 'local') return config.repo;
  return `${config.owner}/${config.repo}`;
}

function ShellHost({ config }: { config: Config | null }) {
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
        />
      ) : null}
    </>
  );
}

export function App({ workspace, initialRecents, hasBridge, initialClaudeAuthed }: AppProps) {
  const [claudeAuthed, setClaudeAuthed] = useState(initialClaudeAuthed);
  const { data: config } = useFetch('config', () => api.config());

  if (hasBridge && !claudeAuthed) {
    return <ClaudeLoginGate onAuthed={() => setClaudeAuthed(true)} />;
  }

  if (hasBridge && !workspace) {
    return (
      <WorkspacePicker initialRecents={initialRecents} onOpened={() => window.location.reload()} />
    );
  }

  return (
    <IssuesProvider>
      <ShellHost config={config ?? null} />
    </IssuesProvider>
  );
}
