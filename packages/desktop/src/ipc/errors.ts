export interface IpcError {
  name: string;
  message: string;
  details?: unknown;
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof Error) {
    const { name, message } = err;
    const details = (err as { run?: unknown }).run;
    return details !== undefined ? { name, message, details } : { name, message };
  }
  return { name: 'UnknownError', message: String(err) };
}
