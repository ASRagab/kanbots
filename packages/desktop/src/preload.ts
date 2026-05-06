import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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
import type {
  BootstrapPayload,
  CloudLoginPollResult,
  CloudLoginStartResult,
  CloudStatusPayload,
  KanbotsBridge,
  RecentCloudWorkspace,
  RecentWorkspace,
} from './types.js';

const INVOKE_PREFIX = 'kanbots:invoke:';

const api: KanbotsBridge = {
  bootstrap: () => ipcRenderer.invoke('kanbots:bootstrap') as Promise<BootstrapPayload>,
  pickFolder: () => ipcRenderer.invoke('kanbots:pick-folder') as Promise<string | null>,
  openWorkspace: (repoPath: string) =>
    ipcRenderer.invoke('kanbots:open-workspace', repoPath) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  closeWorkspace: () => ipcRenderer.invoke('kanbots:close-workspace') as Promise<void>,
  recentWorkspaces: () =>
    ipcRenderer.invoke('kanbots:recent-workspaces') as Promise<RecentWorkspace[]>,
  minimizeWindow: () => ipcRenderer.invoke('kanbots:window-minimize') as Promise<void>,
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('kanbots:window-toggle-maximize') as Promise<void>,
  closeWindow: () => ipcRenderer.invoke('kanbots:window-close') as Promise<void>,
  claudeAuthStatus: () =>
    ipcRenderer.invoke('kanbots:claude-auth-status') as Promise<{ authed: boolean }>,
  claudeLoginStart: () =>
    ipcRenderer.invoke('kanbots:claude-login-start') as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  claudeLoginCancel: () => ipcRenderer.invoke('kanbots:claude-login-cancel') as Promise<void>,
  codexAuthStatus: () =>
    ipcRenderer.invoke('kanbots:codex-auth-status') as Promise<{ authed: boolean }>,
  codexLoginStart: () =>
    ipcRenderer.invoke('kanbots:codex-login-start') as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  codexLoginCancel: () => ipcRenderer.invoke('kanbots:codex-login-cancel') as Promise<void>,
  cloudAuthStatus: () =>
    ipcRenderer.invoke('kanbots:cloud-auth-status') as Promise<CloudStatusPayload>,
  cloudLoginStart: (opts?: { baseUrl?: string }) =>
    ipcRenderer.invoke('kanbots:cloud-login-start', opts) as Promise<CloudLoginStartResult>,
  cloudLoginPoll: () =>
    ipcRenderer.invoke('kanbots:cloud-login-poll') as Promise<CloudLoginPollResult>,
  cloudLoginCancel: () => ipcRenderer.invoke('kanbots:cloud-login-cancel') as Promise<void>,
  cloudLogout: () => ipcRenderer.invoke('kanbots:cloud-logout') as Promise<void>,
  cloudPromptDismiss: () => ipcRenderer.invoke('kanbots:cloud-prompt-dismiss') as Promise<void>,
  cloudUsersMe: () => ipcRenderer.invoke('kanbots:cloud:users-me') as Promise<UserMe>,
  cloudOrgsList: (opts?: { cursor?: string; limit?: number }) =>
    ipcRenderer.invoke('kanbots:cloud:orgs-list', opts) as Promise<OrgListResponse>,
  cloudOrgsCreate: (body: CreateOrgRequest) =>
    ipcRenderer.invoke('kanbots:cloud:orgs-create', body) as Promise<CreateOrgResponse>,
  cloudProjectsList: (orgSlug: string) =>
    ipcRenderer.invoke('kanbots:cloud:projects-list', orgSlug) as Promise<ProjectListResponse>,
  cloudProjectsCreate: (args: { orgSlug: string; body: CreateProjectRequest }) =>
    ipcRenderer.invoke('kanbots:cloud:projects-create', args) as Promise<ProjectSummary>,
  cloudCardsList: (args: {
    orgSlug: string;
    projectSlug: string;
    query?: ListCardsQuery;
  }) => ipcRenderer.invoke('kanbots:cloud:cards-list', args) as Promise<CardListResponse>,
  cloudCardsCreate: (args: {
    orgSlug: string;
    projectSlug: string;
    body: CreateCardRequest;
  }) => ipcRenderer.invoke('kanbots:cloud:cards-create', args) as Promise<CardSummary>,
  cloudCardsUpdate: (args: {
    orgSlug: string;
    projectSlug: string;
    number: number;
    body: UpdateCardRequest;
    ifMatch?: string;
  }) => ipcRenderer.invoke('kanbots:cloud:cards-update', args) as Promise<CardSummary>,
  openCloudWorkspace: (args: { orgSlug: string; projectSlug: string }) =>
    ipcRenderer.invoke('kanbots:open-cloud-workspace', args) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  closeCloudWorkspace: () =>
    ipcRenderer.invoke('kanbots:close-cloud-workspace') as Promise<void>,
  recentCloudWorkspaces: () =>
    ipcRenderer.invoke('kanbots:recent-cloud-workspaces') as Promise<RecentCloudWorkspace[]>,
  setNotifyOnRunComplete: (enabled: boolean) =>
    ipcRenderer.invoke('kanbots:set-notify-on-run-complete', enabled) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  openChat: (conversationId: number | null) =>
    ipcRenderer.invoke('kanbots:open-chat', conversationId) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  invoke: <C extends ChannelName>(channel: C, args: ChannelArgs<C>) =>
    ipcRenderer.invoke(`${INVOKE_PREFIX}${channel}`, args) as Promise<ChannelResult<C>>,
  subscribe: (eventName: string, listener: (payload: unknown) => void) => {
    const wrap = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(eventName, wrap);
    return () => {
      ipcRenderer.removeListener(eventName, wrap);
    };
  },
};

contextBridge.exposeInMainWorld('kanbots', api);
