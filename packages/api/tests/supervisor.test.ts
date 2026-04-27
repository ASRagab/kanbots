import { openStoreInMemory, type Store } from '@kanbots/local-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSupervisor } from '../src/agent-runs/supervisor.js';

describe('createSupervisor', () => {
  let store: Store;
  let threadId: number;

  beforeEach(() => {
    store = openStoreInMemory();
    threadId = store.threads.create({ repoOwner: 'a', repoName: 'b', issueNumber: 1 }).id;
  });

  afterEach(() => {
    store.close();
  });

  it('sweeps stale starting/running rows on construction', () => {
    const stale1 = store.agentRuns.create({ threadId });
    const stale2 = store.agentRuns.create({ threadId });
    store.agentRuns.update(stale1.id, { status: 'starting' });
    store.agentRuns.update(stale2.id, { status: 'running', pid: 9999 });
    const waiting = store.agentRuns.create({ threadId });
    store.agentRuns.update(waiting.id, { status: 'awaiting_input' });

    createSupervisor({ store, repoPath: '/tmp' });

    expect(store.agentRuns.findById(stale1.id)?.status).toBe('failed');
    expect(store.agentRuns.findById(stale2.id)?.status).toBe('failed');
    expect(store.agentRuns.findById(stale2.id)?.pid).toBeNull();
    expect(store.agentRuns.findById(stale2.id)?.exitReason).toMatch(/restart/);
    // awaiting_input is left alone.
    expect(store.agentRuns.findById(waiting.id)?.status).toBe('awaiting_input');
  });
});

describe('supervisor.stop', () => {
  let store: Store;
  let threadId: number;

  beforeEach(() => {
    store = openStoreInMemory();
    threadId = store.threads.create({ repoOwner: 'a', repoName: 'b', issueNumber: 1 }).id;
  });

  afterEach(() => {
    store.close();
  });

  it('marks an active-in-DB-but-untracked run as stopped', async () => {
    const supervisor = createSupervisor({ store, repoPath: '/tmp' });

    const ghost = store.agentRuns.create({ threadId });
    store.agentRuns.update(ghost.id, { status: 'awaiting_input' });

    const result = await supervisor.stop(ghost.id);
    expect(result.status).toBe('stopped');
    expect(result.endedAt).toBeTruthy();
    expect(store.agentRuns.findById(ghost.id)?.status).toBe('stopped');
  });

  it('returns terminal runs unchanged', async () => {
    const supervisor = createSupervisor({ store, repoPath: '/tmp' });

    const done = store.agentRuns.create({ threadId });
    store.agentRuns.update(done.id, { status: 'complete', endedAt: '2026-01-01T00:00:00Z' });

    const result = await supervisor.stop(done.id);
    expect(result.status).toBe('complete');
    expect(result.endedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('throws when the run is missing', async () => {
    const supervisor = createSupervisor({ store, repoPath: '/tmp' });
    await expect(supervisor.stop(99999)).rejects.toThrow(/not found/);
  });
});
