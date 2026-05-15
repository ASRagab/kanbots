import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { toIpcError } from './errors.js';
import { CloudAuthRequiredError, getCloudStatus } from '../cloud-auth.js';
import type { OwnedSubscriptionRegistry } from './subscriptions.js';
import type { Handlers } from '@kanbots/api';

export const CHANNEL_PREFIX = 'kanbots:invoke:';
const SUBSCRIBE_CHANNEL = 'agent-runs:events:subscribe';
const UNSUBSCRIBE_CHANNEL = 'agent-runs:events:unsubscribe';

interface SubscribeArgs {
  runId: number;
  sinceSeq?: number;
}

interface UnsubscribeArgs {
  subscriptionId: string;
}

function wrapHandler(
  fn: (event: IpcMainInvokeEvent, args: unknown) => Promise<unknown> | unknown,
): (event: IpcMainInvokeEvent, args: unknown) => Promise<unknown> {
  return async (event, args) => {
    try {
      // Cloud-only launch: every typed handler requires an active session.
      // Sign-in itself lives on the legacy `kanbots:*` channels in main.ts,
      // so failing here doesn't block the auth flow.
      const status = await getCloudStatus();
      if (!status.authed) throw new CloudAuthRequiredError();
      return await fn(event, args);
    } catch (err) {
      // ipcMain only ships the message field across the IPC boundary, so we
      // serialize the structured error into the message and let the renderer
      // parse it back into a typed Error.
      throw new Error(JSON.stringify(toIpcError(err)));
    }
  };
}

export function registerHandlers(
  handlers: Handlers,
  registry: OwnedSubscriptionRegistry,
): () => void {
  const registered: string[] = [];

  for (const channel of Object.keys(handlers) as Array<keyof Handlers>) {
    if (channel === SUBSCRIBE_CHANNEL || channel === UNSUBSCRIBE_CHANNEL) {
      // Stream 2 owns the streaming wiring — needs event.sender.id for
      // window-scoped cleanup, which the generic Handlers map can't carry.
      continue;
    }
    if (channel.startsWith('providers:')) {
      // Provider config is per-user; registered once at app startup against
      // the app-level store. See providers-ipc.ts.
      continue;
    }
    const handler = handlers[channel] as (args: unknown) => Promise<unknown>;
    ipcMain.handle(
      `${CHANNEL_PREFIX}${channel}`,
      wrapHandler((_event, args) => handler(args)),
    );
    registered.push(channel);
  }

  ipcMain.handle(
    `${CHANNEL_PREFIX}${SUBSCRIBE_CHANNEL}`,
    wrapHandler((event, args) => {
      const a = args as SubscribeArgs;
      return registry.register({
        runId: a.runId,
        ownerId: event.sender.id,
        ...(a.sinceSeq !== undefined ? { sinceSeq: a.sinceSeq } : {}),
      });
    }),
  );
  registered.push(SUBSCRIBE_CHANNEL);

  ipcMain.handle(
    `${CHANNEL_PREFIX}${UNSUBSCRIBE_CHANNEL}`,
    wrapHandler((_event, args) => {
      const a = args as UnsubscribeArgs;
      registry.unregister(a.subscriptionId);
      return undefined;
    }),
  );
  registered.push(UNSUBSCRIBE_CHANNEL);

  return () => {
    for (const channel of registered) {
      ipcMain.removeHandler(`${CHANNEL_PREFIX}${channel}`);
    }
  };
}
