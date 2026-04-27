import type { Db } from '../db.js';
import type { AgentRun, AgentRunId, AgentRunStatus, PreviewState, ThreadId } from '../types.js';

interface AgentRunRow {
  id: number;
  thread_id: number;
  worktree_path: string | null;
  branch_name: string | null;
  pid: number | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  token_usage_input: number | null;
  token_usage_output: number | null;
  exit_reason: string | null;
  session_id: string | null;
  model: string | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
  preview_url: string | null;
  preview_state: string | null;
  preview_pid: number | null;
}

function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    threadId: row.thread_id,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    pid: row.pid,
    status: row.status as AgentRunStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    tokenUsageInput: row.token_usage_input,
    tokenUsageOutput: row.token_usage_output,
    exitReason: row.exit_reason,
    sessionId: row.session_id,
    model: row.model,
    totalCostUsd: row.total_cost_usd,
    durationMs: row.duration_ms,
    previewUrl: row.preview_url,
    previewState: (row.preview_state as PreviewState | null) ?? null,
    previewPid: row.preview_pid,
  };
}

export interface CreateAgentRunInput {
  threadId: ThreadId;
  status?: AgentRunStatus;
  worktreePath?: string;
  branchName?: string;
}

export interface UpdateAgentRunPatch {
  status?: AgentRunStatus;
  worktreePath?: string | null;
  branchName?: string | null;
  pid?: number | null;
  endedAt?: string | null;
  tokenUsageInput?: number | null;
  tokenUsageOutput?: number | null;
  exitReason?: string | null;
  sessionId?: string | null;
  model?: string | null;
  totalCostUsd?: number | null;
  durationMs?: number | null;
  previewUrl?: string | null;
  previewState?: PreviewState | null;
  previewPid?: number | null;
}

const PATCH_COLUMNS: Record<keyof UpdateAgentRunPatch, string> = {
  status: 'status',
  worktreePath: 'worktree_path',
  branchName: 'branch_name',
  pid: 'pid',
  endedAt: 'ended_at',
  tokenUsageInput: 'token_usage_input',
  tokenUsageOutput: 'token_usage_output',
  exitReason: 'exit_reason',
  sessionId: 'session_id',
  model: 'model',
  totalCostUsd: 'total_cost_usd',
  durationMs: 'duration_ms',
  previewUrl: 'preview_url',
  previewState: 'preview_state',
  previewPid: 'preview_pid',
};

const ACTIVE_STATUSES = "('starting', 'running', 'awaiting_input')";

export class AgentRunsRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateAgentRunInput): AgentRun {
    const startedAt = new Date().toISOString();
    const status = input.status ?? 'starting';
    const worktreePath = input.worktreePath ?? null;
    const branchName = input.branchName ?? null;

    const result = this.db
      .prepare(
        `INSERT INTO agent_runs (thread_id, status, started_at, worktree_path, branch_name)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.threadId, status, startedAt, worktreePath, branchName);

    return {
      id: Number(result.lastInsertRowid),
      threadId: input.threadId,
      worktreePath,
      branchName,
      pid: null,
      status,
      startedAt,
      endedAt: null,
      tokenUsageInput: null,
      tokenUsageOutput: null,
      exitReason: null,
      sessionId: null,
      model: null,
      totalCostUsd: null,
      durationMs: null,
      previewUrl: null,
      previewState: null,
      previewPid: null,
    };
  }

  update(id: AgentRunId, patch: UpdateAgentRunPatch): AgentRun {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const key of Object.keys(PATCH_COLUMNS) as (keyof UpdateAgentRunPatch)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      fields.push(`${PATCH_COLUMNS[key]} = ?`);
      values.push(value);
    }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE agent_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    const run = this.findById(id);
    if (!run) throw new Error(`AgentRun ${id} not found`);
    return run;
  }

  findById(id: AgentRunId): AgentRun | null {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as
      | AgentRunRow
      | undefined;
    return row ? rowToAgentRun(row) : null;
  }

  findActiveForThread(threadId: ThreadId): AgentRun | null {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_runs WHERE thread_id = ? AND status IN ${ACTIVE_STATUSES}
         ORDER BY id DESC LIMIT 1`,
      )
      .get(threadId) as AgentRunRow | undefined;
    return row ? rowToAgentRun(row) : null;
  }

  findLatestForThread(threadId: ThreadId): AgentRun | null {
    const row = this.db
      .prepare('SELECT * FROM agent_runs WHERE thread_id = ? ORDER BY id DESC LIMIT 1')
      .get(threadId) as AgentRunRow | undefined;
    return row ? rowToAgentRun(row) : null;
  }

  listByThread(threadId: ThreadId): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE thread_id = ? ORDER BY id')
      .all(threadId) as AgentRunRow[];
    return rows.map(rowToAgentRun);
  }

  listOrphans(): AgentRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_runs WHERE status IN ${ACTIVE_STATUSES} AND pid IS NOT NULL`)
      .all() as AgentRunRow[];
    return rows.map(rowToAgentRun);
  }

  // 'awaiting_input' is intentionally excluded — those runs have already exited
  // cleanly and are waiting for the user. They should resume on the next message.
  markStartingRunningAsInterrupted(reason: string): AgentRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM agent_runs WHERE status IN ('starting', 'running')`)
      .all() as AgentRunRow[];
    if (rows.length === 0) return [];
    const endedAt = new Date().toISOString();
    const update = this.db.prepare(
      `UPDATE agent_runs SET status = 'failed', ended_at = ?, pid = NULL, exit_reason = ?
       WHERE id = ?`,
    );
    const txn = this.db.transaction((ids: number[]) => {
      for (const id of ids) update.run(endedAt, reason, id);
    });
    txn(rows.map((r) => r.id));
    return rows.map((r) => ({ ...rowToAgentRun(r), status: 'failed', endedAt, pid: null, exitReason: reason }));
  }

  sumCostSince(isoDate: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(total_cost_usd), 0) AS sum FROM agent_runs WHERE started_at >= ?',
      )
      .get(isoDate) as { sum: number };
    return row.sum;
  }

  listActiveForRepo(repoOwner: string, repoName: string): Array<AgentRun & { issueNumber: number }> {
    const rows = this.db
      .prepare(
        `SELECT ar.*, t.issue_number AS issue_number_alias
         FROM agent_runs ar
         JOIN threads t ON ar.thread_id = t.id
         WHERE t.repo_owner = ? AND t.repo_name = ?
           AND ar.status IN ${ACTIVE_STATUSES}
         ORDER BY ar.id`,
      )
      .all(repoOwner, repoName) as Array<AgentRunRow & { issue_number_alias: number }>;
    return rows.map((row) => ({
      ...rowToAgentRun(row),
      issueNumber: row.issue_number_alias,
    }));
  }
}
