import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { getBridge } from './desktop-bridge.js';
import type { ActiveWorkspaceInfo, RecentWorkspace } from './desktop-bridge.js';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/card.css';
import './styles/rail.css';
import './styles/inspector.css';
import './styles/modals.css';
import './styles/create-modal.css';
import './styles/tray.css';
import './styles/palette.css';
import './styles/tweaks.css';
import './styles.css';

document.documentElement.setAttribute('data-theme', 'dark');

async function bootstrap(): Promise<{
  workspace: ActiveWorkspaceInfo | null;
  recents: RecentWorkspace[];
  hasBridge: boolean;
  claudeAuthed: boolean;
}> {
  const bridge = getBridge();
  if (!bridge) {
    return { workspace: null, recents: [], hasBridge: false, claudeAuthed: true };
  }
  const payload = await bridge.bootstrap();
  return {
    workspace: payload.workspace,
    recents: payload.recents,
    hasBridge: true,
    claudeAuthed: payload.claudeAuthed,
  };
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element not found');
}
const root = createRoot(container);

void bootstrap().then(({ workspace, recents, hasBridge, claudeAuthed }) => {
  root.render(
    <StrictMode>
      <App
        workspace={workspace}
        initialRecents={recents}
        hasBridge={hasBridge}
        initialClaudeAuthed={claudeAuthed}
      />
    </StrictMode>,
  );
});
