import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, openStoreInMemory } from '../src/index.js';

describe('migrations', () => {
  it('creates all expected tables and indexes', () => {
    const store = openStoreInMemory();
    const tables = store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));

    expect(names).toContain('_migrations');
    expect(names).toContain('threads');
    expect(names).toContain('messages');
    expect(names).toContain('cards');
    expect(names).toContain('agent_runs');
    expect(names).toContain('agent_events');
    expect(names).toContain('promotions');
    expect(names).toContain('http_cache');
    expect(names).toContain('workspaces');
    expect(names).toContain('folders');

    const indexes = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const idxNames = new Set(indexes.map((i) => i.name));
    expect(idxNames).toContain('idx_messages_thread');
    expect(idxNames).toContain('idx_cards_message');
    expect(idxNames).toContain('idx_events_run_seq');

    store.close();
  });

  it('records applied migrations in _migrations', () => {
    const store = openStoreInMemory();
    const rows = store.db.prepare('SELECT id FROM _migrations').all() as { id: string }[];
    // 0019_project_scope is intentionally absent — the file exists on disk
    // but isn't wired into migrations/index.ts yet (cloud-sync columns are
    // dormant). See migrations/index.ts for the rationale.
    expect(rows.map((r) => r.id)).toEqual([
      '0001_initial',
      '0002_agent_session',
      '0003_local_issues',
      '0004_agent_model',
      '0005_workspaces_folders',
      '0006_agent_cost',
      '0007_agent_checks',
      '0008_agent_preview',
      '0009_autopilot_sessions',
      '0010_agent_stop_escalation',
      '0010_cost_budget',
      '0010_sentry',
      '0013_providers',
      '0014_agent_run_provider',
      '0015_thread_last_model',
      '0016_chat_conversations',
      '0017_codex_cli_provider',
      '0018_remove_api_key_providers',
      '0020_run_analytics',
      '0021_learnings',
    ]);
    store.close();
  });

  describe('idempotency', () => {
    let dir: string;
    let dbPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kanbots-test-'));
      dbPath = join(dir, 'db.sqlite');
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('does not re-apply migrations on reopen', () => {
      const s1 = openStore({ path: dbPath });
      const before = s1.db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as {
        n: number;
      };
      s1.close();

      const s2 = openStore({ path: dbPath });
      const after = s2.db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as {
        n: number;
      };
      expect(after.n).toBe(before.n);
      s2.close();
    });

    it('preserves data across reopens', () => {
      const s1 = openStore({ path: dbPath });
      s1.threads.create({ repoOwner: 'octo', repoName: 'repo', issueNumber: 7 });
      s1.close();

      const s2 = openStore({ path: dbPath });
      const t = s2.threads.findByIssue('octo', 'repo', 7);
      expect(t).not.toBeNull();
      expect(t?.issueNumber).toBe(7);
      s2.close();
    });
  });
});
