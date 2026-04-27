import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStoreInMemory, type Store } from '../src/index.js';

describe('AgentRunsRepo', () => {
  let store: Store;
  let threadId: number;

  beforeEach(() => {
    store = openStoreInMemory();
    threadId = store.threads.create({ repoOwner: 'a', repoName: 'b', issueNumber: 1 }).id;
  });

  afterEach(() => {
    store.close();
  });

  it('creates a run with default starting status', () => {
    const r = store.agentRuns.create({ threadId });
    expect(r.status).toBe('starting');
    expect(r.startedAt).toBeTruthy();
    expect(r.endedAt).toBeNull();
    expect(r.pid).toBeNull();
  });

  it('creates with worktree path and branch name', () => {
    const r = store.agentRuns.create({
      threadId,
      worktreePath: '/tmp/x',
      branchName: 'agent/issue-1',
    });
    expect(r.worktreePath).toBe('/tmp/x');
    expect(r.branchName).toBe('agent/issue-1');
  });

  it('updates with patch', () => {
    const r = store.agentRuns.create({ threadId });
    const u = store.agentRuns.update(r.id, {
      status: 'running',
      pid: 12345,
      worktreePath: '/tmp/foo',
    });
    expect(u.status).toBe('running');
    expect(u.pid).toBe(12345);
    expect(u.worktreePath).toBe('/tmp/foo');

    const u2 = store.agentRuns.update(r.id, {
      status: 'complete',
      endedAt: new Date().toISOString(),
      tokenUsageInput: 1000,
      tokenUsageOutput: 500,
    });
    expect(u2.tokenUsageInput).toBe(1000);
    expect(u2.tokenUsageOutput).toBe(500);
    expect(u2.endedAt).toBeTruthy();
    // Earlier patches preserved.
    expect(u2.pid).toBe(12345);
  });

  it('clears nullable fields with explicit null', () => {
    const r = store.agentRuns.create({ threadId, worktreePath: '/tmp/x' });
    const u = store.agentRuns.update(r.id, { worktreePath: null });
    expect(u.worktreePath).toBeNull();
  });

  it('finds active run for a thread', () => {
    const r1 = store.agentRuns.create({ threadId });
    expect(store.agentRuns.findActiveForThread(threadId)?.id).toBe(r1.id);

    store.agentRuns.update(r1.id, { status: 'complete', endedAt: new Date().toISOString() });
    expect(store.agentRuns.findActiveForThread(threadId)).toBeNull();

    const r2 = store.agentRuns.create({ threadId });
    store.agentRuns.update(r2.id, { status: 'awaiting_input' });
    expect(store.agentRuns.findActiveForThread(threadId)?.id).toBe(r2.id);
  });

  it('lists runs by thread', () => {
    store.agentRuns.create({ threadId });
    store.agentRuns.create({ threadId });
    expect(store.agentRuns.listByThread(threadId)).toHaveLength(2);
  });

  it('finds the latest run regardless of status', () => {
    expect(store.agentRuns.findLatestForThread(threadId)).toBeNull();
    const r1 = store.agentRuns.create({ threadId });
    store.agentRuns.update(r1.id, { status: 'failed', endedAt: new Date().toISOString() });
    expect(store.agentRuns.findLatestForThread(threadId)?.id).toBe(r1.id);
    const r2 = store.agentRuns.create({ threadId });
    store.agentRuns.update(r2.id, { status: 'complete', endedAt: new Date().toISOString() });
    expect(store.agentRuns.findLatestForThread(threadId)?.id).toBe(r2.id);
  });

  it('listOrphans surfaces active runs with a recorded pid', () => {
    const r = store.agentRuns.create({ threadId });
    expect(store.agentRuns.listOrphans()).toHaveLength(0);
    store.agentRuns.update(r.id, { status: 'running', pid: 999 });
    expect(store.agentRuns.listOrphans().map((x) => x.id)).toEqual([r.id]);
  });

  it('throws on update of missing run', () => {
    expect(() => store.agentRuns.update(9999, { status: 'running' })).toThrow(/not found/);
  });

  describe('markStartingRunningAsInterrupted', () => {
    it('marks starting/running rows as failed and clears pid', () => {
      const a = store.agentRuns.create({ threadId });
      const b = store.agentRuns.create({ threadId });
      const c = store.agentRuns.create({ threadId });
      store.agentRuns.update(a.id, { status: 'starting' });
      store.agentRuns.update(b.id, { status: 'running', pid: 4242 });
      store.agentRuns.update(c.id, { status: 'complete', endedAt: new Date().toISOString() });

      const swept = store.agentRuns.markStartingRunningAsInterrupted('interrupted: test');
      expect(swept.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());

      const aFresh = store.agentRuns.findById(a.id)!;
      const bFresh = store.agentRuns.findById(b.id)!;
      const cFresh = store.agentRuns.findById(c.id)!;
      expect(aFresh.status).toBe('failed');
      expect(aFresh.endedAt).toBeTruthy();
      expect(aFresh.exitReason).toBe('interrupted: test');
      expect(bFresh.status).toBe('failed');
      expect(bFresh.pid).toBeNull();
      expect(bFresh.exitReason).toBe('interrupted: test');
      // Already-complete row untouched.
      expect(cFresh.status).toBe('complete');
    });

    it('leaves awaiting_input rows alone', () => {
      const r = store.agentRuns.create({ threadId });
      store.agentRuns.update(r.id, { status: 'awaiting_input' });
      const swept = store.agentRuns.markStartingRunningAsInterrupted('interrupted: test');
      expect(swept).toHaveLength(0);
      expect(store.agentRuns.findById(r.id)?.status).toBe('awaiting_input');
    });

    it('is a no-op when no rows match', () => {
      expect(store.agentRuns.markStartingRunningAsInterrupted('x')).toEqual([]);
    });
  });
});
