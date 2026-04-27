import {
  defaultCheckCommand,
  runCheck,
  type CheckCommand,
  type CheckResult,
} from '@kanbots/dispatcher';
import type { AgentCheck, CheckKind, Store } from '@kanbots/local-store';
import { z } from 'zod';
import { badRequest, notFound, parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const listSchema = z
  .object({
    runId: z.number().int().positive(),
  })
  .strict();

const runSchema = z
  .object({
    runId: z.number().int().positive(),
    kinds: z.array(z.enum(['typecheck', 'tests', 'lint', 'e2e'])).optional(),
  })
  .strict();

export interface ListChecksArgs {
  runId: number;
}

export interface RunChecksArgs {
  runId: number;
  kinds?: CheckKind[];
}

export type RunCheckImpl = (options: {
  cwd: string;
  command: CheckCommand;
}) => Promise<CheckResult>;

const inFlight = new Map<number, Set<CheckKind>>();

export async function list(
  deps: HandlerDeps,
  args: ListChecksArgs,
): Promise<AgentCheck[]> {
  const parsed = parseArgs(listSchema, args);
  return deps.store.checks.listLatestByRun(parsed.runId);
}

export interface RunChecksDeps extends HandlerDeps {
  runCheckImpl?: RunCheckImpl;
}

export async function runChecks(
  deps: RunChecksDeps,
  args: RunChecksArgs,
): Promise<AgentCheck[]> {
  const parsed = parseArgs(runSchema, args);
  const run = deps.store.agentRuns.findById(parsed.runId);
  if (!run) throw notFound(`agent run ${parsed.runId} not found`);
  if (!run.worktreePath) throw badRequest('run has no worktree');

  const runImpl: RunCheckImpl =
    deps.runCheckImpl ??
    ((opts) => runCheck({ cwd: opts.cwd, command: opts.command }));

  const kinds: CheckKind[] = parsed.kinds ?? ['typecheck', 'tests', 'lint'];
  const queued = inFlight.get(parsed.runId) ?? new Set<CheckKind>();
  inFlight.set(parsed.runId, queued);

  const started = kinds
    .filter((kind) => !queued.has(kind))
    .map((kind) => deps.store.checks.start({ agentRunId: parsed.runId, kind }));
  for (const kind of kinds) queued.add(kind);

  const cwd = run.worktreePath;
  for (const checkRow of started) {
    const command = defaultCheckCommand(checkRow.kind);
    void runImpl({ cwd, command })
      .then((result) => {
        finishCheck(deps.store, checkRow.id, result.status, result.summary);
      })
      .catch((err: unknown) => {
        finishCheck(
          deps.store,
          checkRow.id,
          'fail',
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => {
        queued.delete(checkRow.kind);
      });
  }

  return started;
}

function finishCheck(
  store: Store,
  id: number,
  status: 'pass' | 'fail',
  summary: string,
): void {
  store.checks.finish({ id, status, summary });
}
