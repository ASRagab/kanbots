// The Window['kanbots'] type and the full KanbotsBridge interface are
// declared in `./global.d.ts` (the bridge is a single object that mixes
// lifecycle methods with the typed invoke/subscribe channels). This
// module owns only the lifecycle data shapes and a small accessor.

export interface ActiveWorkspaceInfo {
  repoPath: string;
  config:
    | { mode: 'github'; owner: string; repo: string }
    | { mode: 'local'; name: string; authorLogin: string };
}

export interface RecentWorkspace {
  repoPath: string;
  displayName: string;
  lastOpenedAt: string;
}

export interface BootstrapPayload {
  workspace: ActiveWorkspaceInfo | null;
  recents: RecentWorkspace[];
  claudeAuthed: boolean;
}

export function getBridge(): NonNullable<Window['kanbots']> | null {
  return typeof window !== 'undefined' && window.kanbots ? window.kanbots : null;
}
