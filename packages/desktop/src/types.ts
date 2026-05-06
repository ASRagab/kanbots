import type { WorkspaceConfig } from '@kanbots/local-store';
import type { ChannelArgs, ChannelName, ChannelResult } from '@kanbots/api';
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

export interface ActiveWorkspaceInfo {
  repoPath: string;
  config: WorkspaceConfig;
}

/**
 * Free-floating cloud workspace — no git repo on disk. The desktop
 * acts as a thick HTTP client over an org+project on Kanbots Cloud.
 * Agent dispatch in this mode prompts for a local repo at run time
 * (or uses a pinned `localRepoPath` if the user bound one to the
 * project; see P4).
 */
export interface ActiveCloudWorkspaceInfo {
  orgSlug: string;
  orgDisplayName: string;
  projectSlug: string;
  projectDisplayName: string;
  /** Pinned local repo for agent dispatch; null until P4 binds one. */
  localRepoPath: string | null;
}

export interface RecentWorkspace {
  repoPath: string;
  displayName: string;
  lastOpenedAt: string;
}

export interface RecentCloudWorkspace {
  orgSlug: string;
  orgDisplayName: string;
  projectSlug: string;
  projectDisplayName: string;
  lastOpenedAt: string;
}

export interface BootstrapPayload {
  workspace: ActiveWorkspaceInfo | null;
  cloudWorkspace: ActiveCloudWorkspaceInfo | null;
  recents: RecentWorkspace[];
  cloudRecents: RecentCloudWorkspace[];
  claudeAuthed: boolean;
  codexAuthed: boolean;
  cloudAuthed: boolean;
  cloudPromptDismissed: boolean;
}

export interface CloudStatusPayload {
  authed: boolean;
  baseUrl: string | null;
  tokenPrefix: string | null;
  orgId: string | null;
  signedInAt: string | null;
  promptDismissed: boolean;
}

export type CloudLoginStartResult =
  | {
      ok: true;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresAt: number;
      intervalMs: number;
    }
  | { ok: false; error: string };

export type CloudLoginPollResult =
  | { status: 'pending' }
  | { status: 'expired' | 'consumed' | 'cancelled' }
  | { status: 'approved'; tokenPrefix: string; orgId: string | null }
  | { status: 'error'; error: string }
  | { status: 'idle' };

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
  cloudProjectsCreate(args: { orgSlug: string; body: CreateProjectRequest }): Promise<ProjectSummary>;
  openCloudWorkspace(args: {
    orgSlug: string;
    projectSlug: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  closeCloudWorkspace(): Promise<void>;
  recentCloudWorkspaces(): Promise<RecentCloudWorkspace[]>;
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
