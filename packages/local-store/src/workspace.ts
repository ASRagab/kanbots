import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface KanbotsDir {
  root: string;
  dbPath: string;
  worktreesDir: string;
  configPath: string;
}

export type WorkspaceMode = 'github' | 'local';

export interface WorkspaceDefaults {
  /** Default per-run cost budget in USD. null/undefined = unbounded. */
  runCostBudgetUsd?: number | null;
  /** Default per-autopilot-session cost budget in USD. null/undefined = unbounded. */
  sessionCostBudgetUsd?: number | null;
}

export type CheckCommandKind = 'typecheck' | 'tests' | 'lint' | 'e2e';

export interface CheckCommandOverride {
  command: string;
  args: string[];
}

export type CheckCommandOverrides = Partial<Record<CheckCommandKind, CheckCommandOverride>>;

interface WorkspaceConfigCommon {
  checks?: CheckCommandOverrides;
  /**
   * Workspace-wide rules prepended to every agent prompt (issue runs, chat
   * runs, autopilot child runs). Stored verbatim; trimmed on read. Capped at
   * HOUSE_RULES_MAX_BYTES to keep system-prompt overhead bounded.
   */
  houseRules?: string;
}

export const HOUSE_RULES_MAX_BYTES = 8 * 1024;

export interface GitHubWorkspaceConfig extends WorkspaceConfigCommon {
  mode: 'github';
  owner: string;
  repo: string;
  defaults?: WorkspaceDefaults;
  notifyOnRunComplete?: boolean;
}

export interface LocalWorkspaceConfig extends WorkspaceConfigCommon {
  mode: 'local';
  name: string;
  authorLogin: string;
  defaults?: WorkspaceDefaults;
  notifyOnRunComplete?: boolean;
}

export type WorkspaceConfig = GitHubWorkspaceConfig | LocalWorkspaceConfig;

const CHECK_KINDS: readonly CheckCommandKind[] = ['typecheck', 'tests', 'lint', 'e2e'];

function validateCheckOverrides(input: unknown): CheckCommandOverrides | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'object' || input === null) {
    console.warn('[kanbots] ignoring invalid `checks` field in .kanbots/config.json (expected object)');
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  const out: CheckCommandOverrides = {};
  for (const key of Object.keys(obj)) {
    if (!CHECK_KINDS.includes(key as CheckCommandKind)) {
      console.warn(`[kanbots] ignoring unknown check kind "${key}" in .kanbots/config.json`);
      continue;
    }
    const entry = obj[key];
    if (typeof entry !== 'object' || entry === null) {
      console.warn(`[kanbots] ignoring invalid override for "${key}" (expected object)`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.command !== 'string' || e.command.length === 0) {
      console.warn(`[kanbots] ignoring invalid override for "${key}" (missing string "command")`);
      continue;
    }
    if (!Array.isArray(e.args) || !e.args.every((a) => typeof a === 'string')) {
      console.warn(`[kanbots] ignoring invalid override for "${key}" (expected "args": string[])`);
      continue;
    }
    out[key as CheckCommandKind] = { command: e.command, args: e.args.slice() };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function describeKanbotsDir(repoPath: string): KanbotsDir {
  const root = join(repoPath, '.kanbots');
  return {
    root,
    dbPath: join(root, 'db.sqlite'),
    worktreesDir: join(root, 'worktrees'),
    configPath: join(root, 'config.json'),
  };
}

export async function ensureKanbotsDir(repoPath: string): Promise<KanbotsDir> {
  const dir = describeKanbotsDir(repoPath);
  await mkdir(dir.worktreesDir, { recursive: true });
  return dir;
}

export async function readWorkspaceConfig(repoPath: string): Promise<WorkspaceConfig | null> {
  const { configPath } = describeKanbotsDir(repoPath);
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return validateConfig(parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeWorkspaceConfig(
  repoPath: string,
  config: WorkspaceConfig,
): Promise<void> {
  const { configPath } = describeKanbotsDir(repoPath);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function validateConfig(input: unknown): WorkspaceConfig | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const defaults = parseDefaults(obj.defaults);
  const checks = validateCheckOverrides(obj.checks);
  const notify = typeof obj.notifyOnRunComplete === 'boolean' ? obj.notifyOnRunComplete : undefined;
  const houseRules = validateHouseRules(obj.houseRules);
  if (obj.mode === 'github' && typeof obj.owner === 'string' && typeof obj.repo === 'string') {
    const cfg: GitHubWorkspaceConfig = { mode: 'github', owner: obj.owner, repo: obj.repo };
    if (defaults) cfg.defaults = defaults;
    if (checks) cfg.checks = checks;
    if (notify !== undefined) cfg.notifyOnRunComplete = notify;
    if (houseRules !== undefined) cfg.houseRules = houseRules;
    return cfg;
  }
  if (obj.mode === 'local' && typeof obj.name === 'string' && typeof obj.authorLogin === 'string') {
    const cfg: LocalWorkspaceConfig = { mode: 'local', name: obj.name, authorLogin: obj.authorLogin };
    if (defaults) cfg.defaults = defaults;
    if (checks) cfg.checks = checks;
    if (notify !== undefined) cfg.notifyOnRunComplete = notify;
    if (houseRules !== undefined) cfg.houseRules = houseRules;
    return cfg;
  }
  return null;
}

function validateHouseRules(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'string') {
    console.warn('[kanbots] ignoring invalid `houseRules` field in .kanbots/config.json (expected string)');
    return undefined;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (Buffer.byteLength(trimmed, 'utf8') > HOUSE_RULES_MAX_BYTES) {
    console.warn(
      `[kanbots] ignoring \`houseRules\` exceeding ${HOUSE_RULES_MAX_BYTES} bytes; rules will not be applied`,
    );
    return undefined;
  }
  return trimmed;
}

function parseDefaults(input: unknown): WorkspaceDefaults | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const out: WorkspaceDefaults = {};
  if (typeof obj.runCostBudgetUsd === 'number' && Number.isFinite(obj.runCostBudgetUsd)) {
    out.runCostBudgetUsd = obj.runCostBudgetUsd;
  } else if (obj.runCostBudgetUsd === null) {
    out.runCostBudgetUsd = null;
  }
  if (typeof obj.sessionCostBudgetUsd === 'number' && Number.isFinite(obj.sessionCostBudgetUsd)) {
    out.sessionCostBudgetUsd = obj.sessionCostBudgetUsd;
  } else if (obj.sessionCostBudgetUsd === null) {
    out.sessionCostBudgetUsd = null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveGitUserName(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['config', 'user.name'], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    const name = stdout.trim();
    if (name) return name;
  } catch {
    // fall through
  }
  return 'you';
}

export async function ensureGitignoreEntry(gitRoot: string, entry: string): Promise<boolean> {
  const path = join(gitRoot, '.gitignore');

  if (!existsSync(path)) {
    await writeFile(path, `${entry}\n`, 'utf-8');
    return true;
  }

  const content = await readFile(path, 'utf-8');
  const target = entry.replace(/\/+$/, '');
  const present = content.split('\n').some((line) => {
    const cleaned = line.trim().replace(/^\/+|\/+$/g, '');
    return cleaned === target;
  });

  if (present) return false;

  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  await appendFile(path, `${sep}${entry}\n`, 'utf-8');
  return true;
}
