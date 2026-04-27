import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { AgentRun } from '@kanbots/local-store';
import { z } from 'zod';
import type {
  DiffFile,
  DiffFileStatus,
  DiffPayload,
  ForkRunResult,
  PromoteCommitResult,
  PromotePrResult,
  RunStatsResult,
} from '../bridge.js';
import { badRequest, notFound, parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const execFileAsync = promisify(execFile);

const idSchema = z
  .object({
    runId: z.number().int().positive(),
  })
  .strict();

export interface RunIdArgs {
  runId: number;
}

export async function get(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<AgentRun> {
  const parsed = parseArgs(idSchema, args);
  const run = deps.supervisor.getRun(parsed.runId);
  if (!run) throw notFound(`agent run ${parsed.runId} not found`);
  return run;
}

export async function stop(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<AgentRun> {
  const parsed = parseArgs(idSchema, args);
  return deps.supervisor.stop(parsed.runId);
}

export async function diff(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<DiffPayload> {
  const parsed = parseArgs(idSchema, args);
  const run = deps.store.agentRuns.findById(parsed.runId);
  if (!run) throw notFound(`agent run ${parsed.runId} not found`);
  if (!run.worktreePath) throw badRequest('run has no worktree');
  return collectDiff(run.worktreePath, run.branchName);
}

interface StatsCacheEntry {
  expiresAt: number;
  payload: RunStatsResult;
}

const STATS_CACHE_MS = 5_000;
const statsCache = new Map<number, StatsCacheEntry>();

export async function stats(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<RunStatsResult> {
  const parsed = parseArgs(idSchema, args);
  const cached = statsCache.get(parsed.runId);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const run = deps.store.agentRuns.findById(parsed.runId);
  if (!run) throw notFound(`agent run ${parsed.runId} not found`);
  if (!run.worktreePath) throw badRequest('run has no worktree');

  const collected = await collectDiff(run.worktreePath, run.branchName);
  let additions = 0;
  let deletions = 0;
  for (const file of collected.files) {
    for (const line of file.patch.split('\n')) {
      if (
        line.startsWith('+++') ||
        line.startsWith('---') ||
        line.startsWith('diff ')
      ) {
        continue;
      }
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
    }
  }
  const payload: RunStatsResult = {
    additions,
    deletions,
    filesChanged: collected.files.length,
  };
  statsCache.set(parsed.runId, {
    expiresAt: Date.now() + STATS_CACHE_MS,
    payload,
  });
  return payload;
}

export async function fork(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<ForkRunResult> {
  const parsed = parseArgs(idSchema, args);
  const source = deps.store.agentRuns.findById(parsed.runId);
  if (!source) throw notFound(`run ${parsed.runId} not found`);
  if (!source.worktreePath || !source.branchName) {
    throw badRequest('source run has no worktree to fork from');
  }
  const thread = deps.store.threads.findById(source.threadId);
  if (!thread) throw badRequest('source run has no thread');

  const { stdout: headSha } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: source.worktreePath,
  });
  const sha = headSha.trim();
  const stamp = Date.now().toString(36);
  const newBranch = `${source.branchName}-fork-${stamp}`;
  const newWorktreePath = `${source.worktreePath}-fork-${stamp}`;
  await mkdir(dirname(newWorktreePath), { recursive: true });
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', newBranch, newWorktreePath, sha],
    { cwd: source.worktreePath },
  );
  const run = await deps.supervisor.start({
    threadId: thread.id,
    issueNumber: thread.issueNumber,
    prompt: `Continue from a fork of run #${parsed.runId} (branch ${source.branchName}).`,
    ...(source.model ? { model: source.model } : {}),
  });
  return { source: parsed.runId, run, worktree: newWorktreePath, branch: newBranch };
}

export async function promoteCommit(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<PromoteCommitResult> {
  const parsed = parseArgs(idSchema, args);
  const repoPath = deps.config.repoPath;
  if (!repoPath) throw badRequest('repoPath is not configured');
  const run = deps.store.agentRuns.findById(parsed.runId);
  if (!run) throw notFound(`run ${parsed.runId} not found`);
  if (!run.worktreePath || !run.branchName) {
    throw badRequest('run has no worktree or branch to promote');
  }
  const thread = deps.store.threads.findById(run.threadId);
  if (!thread) throw badRequest('run has no thread');
  const issue = await deps.source.getIssue(thread.issueNumber);

  const base = await detectLocalBase(repoPath);
  const stamp = Date.now().toString(36);
  const tmpPath = `${repoPath}/.kanbots/promote/${parsed.runId}-${stamp}`;
  await mkdir(dirname(tmpPath), { recursive: true });
  await execFileAsync('git', ['worktree', 'add', tmpPath, base], { cwd: repoPath });
  try {
    await execFileAsync('git', ['merge', '--squash', run.branchName], { cwd: tmpPath });
    const message = `Issue #${issue.number}: ${issue.title}`;
    await execFileAsync('git', ['commit', '-m', message], { cwd: tmpPath });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpPath });
    return { commitSha: stdout.trim(), base };
  } finally {
    await execFileAsync(
      'git',
      ['worktree', 'remove', '--force', tmpPath],
      { cwd: repoPath },
    ).catch(() => undefined);
  }
}

export async function promotePr(
  deps: HandlerDeps,
  args: RunIdArgs,
): Promise<PromotePrResult> {
  const parsed = parseArgs(idSchema, args);
  if (deps.config.mode !== 'github') {
    throw badRequest('PR creation requires github mode');
  }
  const openDraftPR = deps.source.openDraftPR;
  if (typeof openDraftPR !== 'function') {
    throw badRequest('source does not support PR creation');
  }
  const repoPath = deps.config.repoPath;
  if (!repoPath) throw badRequest('repoPath is not configured');
  const run = deps.store.agentRuns.findById(parsed.runId);
  if (!run) throw notFound(`run ${parsed.runId} not found`);
  if (!run.worktreePath || !run.branchName) {
    throw badRequest('run has no worktree or branch to promote');
  }
  const thread = deps.store.threads.findById(run.threadId);
  if (!thread) throw badRequest('run has no thread');
  const issue = await deps.source.getIssue(thread.issueNumber);

  await execFileAsync('git', ['push', '-u', 'origin', run.branchName], {
    cwd: run.worktreePath,
  });

  const base = (await detectLocalBase(repoPath)).replace(/^origin\//, '');
  const pr = await openDraftPR.call(deps.source, {
    title: issue.title,
    ...(issue.body ? { body: issue.body } : {}),
    head: run.branchName,
    base,
    issueNumber: issue.number,
  });
  return { pr };
}

async function detectLocalBase(repoPath: string): Promise<string> {
  for (const ref of ['main', 'master']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: repoPath });
      return ref;
    } catch {
      // try next
    }
  }
  throw badRequest('could not find a local main/master branch to promote into');
}

async function collectDiff(
  worktreePath: string,
  branchName: string | null,
): Promise<DiffPayload> {
  const base = await detectBase(worktreePath);
  const tracked = await diffAgainstBase(worktreePath, base);
  const untracked = await listUntrackedFiles(worktreePath);
  const files: DiffFile[] = [];

  for (const f of tracked) files.push(f);
  for (const path of untracked) {
    files.push({
      path,
      status: 'untracked',
      patch: await readUntracked(worktreePath, path),
    });
  }

  return {
    base,
    branch: branchName,
    files,
    empty: files.length === 0,
  };
}

async function detectBase(cwd: string): Promise<string> {
  for (const ref of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd });
      return ref;
    } catch {
      // try next
    }
  }
  return 'HEAD';
}

async function diffAgainstBase(cwd: string, base: string): Promise<DiffFile[]> {
  const nameStatus = await execFileAsync(
    'git',
    ['diff', '--name-status', `${base}...HEAD`],
    { cwd, maxBuffer: 16 * 1024 * 1024 },
  ).catch(async () =>
    execFileAsync('git', ['diff', '--name-status', 'HEAD'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );

  const statuses = parseNameStatus(nameStatus.stdout);
  if (statuses.length === 0) return [];

  const patchOut = await execFileAsync('git', ['diff', `${base}...HEAD`], {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  }).catch(async () =>
    execFileAsync('git', ['diff', 'HEAD'], { cwd, maxBuffer: 32 * 1024 * 1024 }),
  );

  const patches = splitUnifiedDiff(patchOut.stdout);
  return statuses.map((s) => ({
    path: s.path,
    status: s.status,
    patch: patches.get(s.path) ?? '',
  }));
}

interface NameStatusRow {
  path: string;
  status: DiffFileStatus;
}

function parseNameStatus(stdout: string): NameStatusRow[] {
  const rows: NameStatusRow[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\t/);
    const code = parts[0]?.[0] ?? '';
    const path = parts[parts.length - 1] ?? '';
    if (!path) continue;
    rows.push({ path, status: codeToStatus(code) });
  }
  return rows;
}

function codeToStatus(code: string): DiffFileStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'other';
  }
}

function splitUnifiedDiff(diff: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!diff) return out;
  const blocks = diff
    .split(/^(?=diff --git )/m)
    .filter((b) => b.startsWith('diff --git '));
  for (const block of blocks) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(block);
    const path = headerMatch ? (headerMatch[2] ?? headerMatch[1] ?? null) : null;
    if (path) out.set(path, block);
  }
  return out;
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readUntracked(cwd: string, path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-index', '/dev/null', path],
      { cwd, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; code?: number };
    if (typeof e.stdout === 'string') return e.stdout;
    return '';
  }
}
