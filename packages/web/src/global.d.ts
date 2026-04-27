// Renderer ↔ main IPC bridge contract.
//
// Channel definitions are the canonical ones from `@kanbots/api`.
// Keep the `KanbotsBridge` interface here because it also includes
// the desktop-only lifecycle methods (bootstrap, openWorkspace, etc.).

import type {
  AgentRunEventPayload,
  BridgeChannels,
  ChannelArgs,
  ChannelName,
  ChannelResult,
  PostMessageResult,
  UploadAttachmentResult,
} from '@kanbots/api';
import type {
  ActiveWorkspaceInfo,
  BootstrapPayload,
  RecentWorkspace,
} from './desktop-bridge.js';

export type {
  AgentRunEventPayload,
  BridgeChannels,
  ChannelArgs,
  ChannelName,
  ChannelResult,
  PostMessageResult,
  UploadAttachmentResult,
};

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

  invoke<C extends ChannelName>(
    channel: C,
    args: ChannelArgs<C>,
  ): Promise<ChannelResult<C>>;
  subscribe(eventName: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    kanbots?: KanbotsBridge;
  }
}

export type { ActiveWorkspaceInfo, BootstrapPayload, RecentWorkspace };
