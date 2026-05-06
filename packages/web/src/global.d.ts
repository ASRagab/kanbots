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
  CardListResponse,
  CardSummary,
  CreateCardRequest,
  CreateOrgRequest,
  CreateOrgResponse,
  CreateProjectRequest,
  ListCardsQuery,
  OrgListResponse,
  ProjectListResponse,
  ProjectSummary,
  UpdateCardRequest,
  UserMe,
} from '@kanbots/cloud-client';
import type {
  ActiveCloudWorkspaceInfo,
  ActiveWorkspaceInfo,
  BootstrapPayload,
  CloudLoginPollResult,
  CloudLoginStartResult,
  CloudStatusPayload,
  RecentCloudWorkspace,
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
  codexAuthStatus(): Promise<{ authed: boolean }>;
  codexLoginStart(): Promise<{ ok: true } | { ok: false; error: string }>;
  codexLoginCancel(): Promise<void>;
  cloudAuthStatus(): Promise<CloudStatusPayload>;
  cloudLoginStart(opts?: { baseUrl?: string }): Promise<CloudLoginStartResult>;
  cloudLoginPoll(): Promise<CloudLoginPollResult>;
  cloudLoginCancel(): Promise<void>;
  cloudLogout(): Promise<void>;
  cloudPromptDismiss(): Promise<void>;
  cloudUsersMe(): Promise<UserMe>;
  cloudOrgsList(opts?: { cursor?: string; limit?: number }): Promise<OrgListResponse>;
  cloudOrgsCreate(body: CreateOrgRequest): Promise<CreateOrgResponse>;
  cloudProjectsList(orgSlug: string): Promise<ProjectListResponse>;
  cloudProjectsCreate(args: {
    orgSlug: string;
    body: CreateProjectRequest;
  }): Promise<ProjectSummary>;
  cloudCardsList(args: {
    orgSlug: string;
    projectSlug: string;
    query?: ListCardsQuery;
  }): Promise<CardListResponse>;
  cloudCardsCreate(args: {
    orgSlug: string;
    projectSlug: string;
    body: CreateCardRequest;
  }): Promise<CardSummary>;
  cloudCardsUpdate(args: {
    orgSlug: string;
    projectSlug: string;
    number: number;
    body: UpdateCardRequest;
    ifMatch?: string;
  }): Promise<CardSummary>;
  openCloudWorkspace(args: {
    orgSlug: string;
    projectSlug: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  closeCloudWorkspace(): Promise<void>;
  recentCloudWorkspaces(): Promise<RecentCloudWorkspace[]>;
  setNotifyOnRunComplete(
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  openChat?(
    conversationId: number | null,
  ): Promise<{ ok: true } | { ok: false; error: string }>;

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

export type {
  ActiveCloudWorkspaceInfo,
  ActiveWorkspaceInfo,
  BootstrapPayload,
  CloudLoginPollResult,
  CloudLoginStartResult,
  CloudStatusPayload,
  RecentCloudWorkspace,
  RecentWorkspace,
};
