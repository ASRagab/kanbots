import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ChannelArgs, ChannelName, ChannelResult } from '@kanbots/api';
import type { BootstrapPayload, KanbotsBridge, RecentWorkspace } from './types.js';

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
