import type {
  ChannelArgs,
  ChannelName,
  ChannelResult,
  KanbotsBridge,
} from '../global.js';

type Handlers = {
  [C in ChannelName]?: (args: ChannelArgs<C>) => Promise<ChannelResult<C>>;
};

interface FakeBridgeExtras {
  // Test-only: drive subscribe listeners as if the main process
  // pushed an event. Production code must not call this.
  push(eventName: string, payload: unknown): void;
}

export type FakeBridge = KanbotsBridge & FakeBridgeExtras;

interface InstallOptions {
  handlers?: Handlers;
  // Optional partial lifecycle overrides; useful for tests that exercise
  // bootstrap-time flows without standing up the full main process.
  lifecycle?: Partial<KanbotsBridge>;
}

/**
 * Installs a fake `window.kanbots` driven by in-memory handlers.
 *
 * Used by:
 *   - component tests that need a deterministic bridge,
 *   - dev mode while pivot/02-bridge is in flight (renderer falls
 *     back to this if the real bridge is missing).
 *
 * Returns the installed bridge so the caller can drive subscribe
 * listeners via `bridge.push('agent-runs:events:data', payload)`.
 */
export function installFakeBridge(opts: InstallOptions = {}): FakeBridge {
  const handlers: Handlers = opts.handlers ?? {};
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const lifecycleDefaults: Pick<
    KanbotsBridge,
    | 'bootstrap'
    | 'pickFolder'
    | 'openWorkspace'
    | 'closeWorkspace'
    | 'recentWorkspaces'
    | 'minimizeWindow'
    | 'toggleMaximizeWindow'
    | 'closeWindow'
    | 'claudeAuthStatus'
    | 'claudeLoginStart'
    | 'claudeLoginCancel'
    | 'codexAuthStatus'
    | 'codexLoginStart'
    | 'codexLoginCancel'
    | 'setNotifyOnRunComplete'
  > = {
    bootstrap: () =>
      Promise.resolve({
        workspace: null,
        recents: [],
        claudeAuthed: true,
        codexAuthed: true,
      }),
    pickFolder: () => Promise.resolve(null),
    openWorkspace: () => Promise.resolve({ ok: true }),
    closeWorkspace: () => Promise.resolve(),
    recentWorkspaces: () => Promise.resolve([]),
    minimizeWindow: () => Promise.resolve(),
    toggleMaximizeWindow: () => Promise.resolve(),
    closeWindow: () => Promise.resolve(),
    claudeAuthStatus: () => Promise.resolve({ authed: true }),
    claudeLoginStart: () => Promise.resolve({ ok: true }),
    claudeLoginCancel: () => Promise.resolve(),
    codexAuthStatus: () => Promise.resolve({ authed: true }),
    codexLoginStart: () => Promise.resolve({ ok: true }),
    codexLoginCancel: () => Promise.resolve(),
    setNotifyOnRunComplete: () => Promise.resolve({ ok: true }),
  };

  const bridge: FakeBridge = {
    ...lifecycleDefaults,
    ...opts.lifecycle,
    invoke: <C extends ChannelName>(
      channel: C,
      args: ChannelArgs<C>,
    ): Promise<ChannelResult<C>> => {
      const fn = handlers[channel];
      if (!fn) {
        return Promise.reject(new Error(`fake bridge: no handler for ${channel}`));
      }
      return fn(args);
    },
    subscribe: (eventName, listener) => {
      const set = listeners.get(eventName) ?? new Set();
      set.add(listener);
      listeners.set(eventName, set);
      return () => {
        set.delete(listener);
      };
    },
    push: (eventName, payload) => {
      const set = listeners.get(eventName);
      if (!set) return;
      for (const listener of set) listener(payload);
    },
  };

  if (typeof window === 'undefined') {
    // jsdom-less environments (e.g. node-only tests) — synthesize a
    // window stub so renderer code can read window.kanbots.
    (globalThis as { window?: Window }).window = globalThis as unknown as Window;
  }
  (window as { kanbots?: KanbotsBridge }).kanbots = bridge;

  return bridge;
}

/**
 * Removes the fake bridge from window. Useful between tests.
 */
export function uninstallFakeBridge(): void {
  if (typeof window === 'undefined') return;
  delete (window as { kanbots?: KanbotsBridge }).kanbots;
}
