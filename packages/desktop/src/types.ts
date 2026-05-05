import type { WorkspaceConfig } from '@kanbots/local-store';
import type { ChannelArgs, ChannelName, ChannelResult } from '@kanbots/api';

export interface ActiveWorkspaceInfo {
  repoPath: string;
  config: WorkspaceConfig;
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
  codexAuthed: boolean;
}

export interface KanbotsBridge {
  bootstrap(): Promise<BootstrapPayload>;
  pickFolder(): Promise<string | null>;
  openWorkspace(repoPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
  closeWorkspace(): Promise<void>;
  recentWorkspaces(): Promise<RecentWorkspace[]>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  claudeAuthStatus(): Promise<{ authed: boolean }>;
  claudeLoginStart(): Promise<{ ok: true } | { ok: false; error: string }>;
  claudeLoginCancel(): Promise<void>;
  codexAuthStatus(): Promise<{ authed: boolean }>;
  codexLoginStart(): Promise<{ ok: true } | { ok: false; error: string }>;
  codexLoginCancel(): Promise<void>;
  setNotifyOnRunComplete(
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  openChat?(
    conversationId: number | null,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  invoke<C extends ChannelName>(channel: C, args: ChannelArgs<C>): Promise<ChannelResult<C>>;
  subscribe(eventName: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    kanbots?: KanbotsBridge;
  }
}
