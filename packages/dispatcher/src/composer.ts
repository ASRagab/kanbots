import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';

export interface DraftIssueInput {
  description: string;
}

export interface DraftedIssue {
  title: string;
  body: string;
}

export interface BacklogEntry {
  title: string;
  body?: string;
}

export interface SuggestFeatureInput {
  backlog: BacklogEntry[];
  personaPrompt: string;
}

export interface CreateComposerOptions {
  cwd: string;
  command?: string;
  timeoutMs?: number;
  systemPrompt?: string;
  spawn?: SpawnFn;
}

export type CreateSuggesterOptions = CreateComposerOptions;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => ChildProcess;

export type DraftIssueFn = (input: DraftIssueInput) => Promise<DraftedIssue>;
export type SuggestFeatureFn = (input: SuggestFeatureInput) => Promise<DraftedIssue>;

const DEFAULT_TIMEOUT_MS = 120_000;

const ISSUE_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'body'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 200 },
    body: { type: 'string' },
  },
} as const;

const DEFAULT_SYSTEM_PROMPT = `You are an issue composer for a software project.

The user gives you a natural-language description. Produce a single well-structured GitHub issue.

You have read-only access to the repo via Read, Glob, and Grep. Investigate when it would make the issue clearer or more actionable — e.g. naming the right file/symbol — but do not over-investigate. Aim for a draft within a few tool calls.

Rules:
- Title: concise, imperative, ≤80 chars, no trailing punctuation.
- Body: markdown. Cover problem/motivation, proposed approach (if obvious from the user's input), and acceptance criteria. Reference files or symbols by path when you have grounded them in the code.
- Do NOT invent details the user did not provide and that you cannot verify. If something is unclear, write the body so the implementer knows what's underspecified rather than guessing.
- Output strictly the JSON object matching the schema.
`;

function buildSuggestSystemPrompt(personaPrompt: string): string {
  const trimmedPersona = personaPrompt.trim();
  const persona =
    trimmedPersona.length > 0
      ? trimmedPersona
      : 'You are a product strategist for a software project.';
  return `${persona}

Look at the repo (use Read/Glob/Grep — start with README.md, package.json, and top-level source dirs) and the backlog the user supplies. Propose ONE concrete next feature or task that fits this project's direction and the perspective described above. Aim for a useful suggestion within a few tool calls — do not exhaustively map the codebase.

Rules:
- Apply your perspective specifically. The suggestion should clearly reflect what someone in your role would prioritize and why.
- Pick something the project does not already have and is not already in the backlog. Read the backlog carefully so you don't duplicate.
- Prefer small/medium scope: something a single agent can ship as one PR.
- Title: concise, imperative, ≤80 chars, no trailing punctuation.
- Body: markdown. Explain motivation (framed from your perspective), proposed approach grounded in real files/symbols you've seen, and 2-4 acceptance criteria. Reference paths when you can.
- Do NOT invent files, modules, or capabilities you have not verified by reading the code. If something is uncertain, say so and let the implementer figure it out rather than guessing.
- Output strictly the JSON object matching the schema.
`;
}

const draftedSchema = z
  .object({
    title: z.string().min(1),
    body: z.string(),
  })
  .strict();

const claudeResultSchema = z
  .object({
    type: z.literal('result'),
    is_error: z.boolean(),
    subtype: z.string().optional(),
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
  })
  .passthrough();

export class ComposerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string = '',
  ) {
    super(message);
    this.name = 'ComposerError';
  }
}

interface RunClaudeOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  systemPrompt: string;
  stdin: string;
  spawn: SpawnFn;
}

async function runClaudeForDraftedIssue(opts: RunClaudeOptions): Promise<DraftedIssue> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--system-prompt',
    opts.systemPrompt,
    '--json-schema',
    JSON.stringify(ISSUE_JSON_SCHEMA),
    '--tools',
    'Read,Glob,Grep',
  ];

  const child = opts.spawn(opts.command, args, { cwd: opts.cwd });
  let stdout = '';
  let stderr = '';
  let killedByTimeout = false;

  const timer = setTimeout(() => {
    killedByTimeout = true;
    child.kill('SIGTERM');
  }, opts.timeoutMs);

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  if (!child.stdin) {
    clearTimeout(timer);
    throw new ComposerError('failed to open stdin to claude');
  }
  child.stdin.write(opts.stdin);
  child.stdin.end();

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });

  if (killedByTimeout) {
    throw new ComposerError(`composer timed out after ${opts.timeoutMs}ms`, stderr);
  }
  if (exitCode !== 0) {
    throw new ComposerError(`claude exited with code ${exitCode}`, stderr);
  }

  const parsedJson = parseJsonOrThrow(stdout, stderr);
  const result = claudeResultSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new ComposerError(`unexpected claude output shape: ${result.error.message}`, stderr);
  }
  if (result.data.is_error) {
    throw new ComposerError(result.data.result ?? 'claude reported an error', stderr);
  }
  const drafted = draftedSchema.safeParse(result.data.structured_output);
  if (!drafted.success) {
    throw new ComposerError(
      `agent did not return a valid drafted issue: ${drafted.error.message}`,
      stderr,
    );
  }
  return drafted.data;
}

export function createComposer(opts: CreateComposerOptions): DraftIssueFn {
  const command = opts.command ?? 'claude';
  const cwd = opts.cwd;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const spawn = opts.spawn ?? nodeSpawn;

  return async function draftIssue(input: DraftIssueInput): Promise<DraftedIssue> {
    return runClaudeForDraftedIssue({
      command,
      cwd,
      timeoutMs,
      systemPrompt,
      stdin: input.description,
      spawn,
    });
  };
}

export function createSuggester(opts: CreateSuggesterOptions): SuggestFeatureFn {
  const command = opts.command ?? 'claude';
  const cwd = opts.cwd;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const systemPromptOverride = opts.systemPrompt;
  const spawn = opts.spawn ?? nodeSpawn;

  return async function suggestFeature(input: SuggestFeatureInput): Promise<DraftedIssue> {
    const systemPrompt = systemPromptOverride ?? buildSuggestSystemPrompt(input.personaPrompt);
    return runClaudeForDraftedIssue({
      command,
      cwd,
      timeoutMs,
      systemPrompt,
      stdin: formatBacklogPrompt(input.backlog),
      spawn,
    });
  };
}

function formatBacklogPrompt(backlog: BacklogEntry[]): string {
  if (backlog.length === 0) {
    return 'The backlog is currently empty. Suggest a strong first task for this project.';
  }
  const lines = backlog.map((item, idx) => {
    const trimmedBody = (item.body ?? '').trim();
    const summary = trimmedBody.length > 280 ? `${trimmedBody.slice(0, 280)}…` : trimmedBody;
    return summary
      ? `${idx + 1}. ${item.title}\n   ${summary.replace(/\n/g, ' ')}`
      : `${idx + 1}. ${item.title}`;
  });
  return `Existing backlog (do not duplicate any of these):\n\n${lines.join('\n')}\n\nSuggest one new feature or task that fits this project.`;
}

function parseJsonOrThrow(stdout: string, stderr: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ComposerError('claude produced no output', stderr);
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new ComposerError(
      `claude output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      stderr,
    );
  }
}
