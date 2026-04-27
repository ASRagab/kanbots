import { statusFromLabels } from '@kanbots/core';
import type {
  AutopilotChildEntry,
  AutopilotChildStatus,
  AutopilotPersonaSnapshot,
  AutopilotSession,
} from '@kanbots/local-store';
import { dispatchAutopilotChild } from './dispatch-helpers.js';
import { type OrchestratorContext, waitForChildSettled } from './orchestrator.js';

const BACKLOG_SAMPLE_LIMIT = 30;

export async function runFeatureDevLoop(
  ctx: OrchestratorContext,
  initialSession: AutopilotSession,
  signal: AbortSignal,
): Promise<void> {
  if (initialSession.config.kind !== 'feature-dev') {
    throw new Error('feature-dev loop given non-feature-dev session');
  }
  const personas = initialSession.config.personas;
  if (personas.length === 0) {
    throw new Error('feature-dev autopilot requires at least one persona');
  }

  // Fresh session reads each iteration so cycle_index/children are current.
  while (!signal.aborted) {
    const session = ctx.store.autopilotSessions.findById(initialSession.id);
    if (!session) return;
    if (session.status !== 'running') return;

    const persona = personas[session.cycleIndex % personas.length] as AutopilotPersonaSnapshot;
    let stepError: Error | null = null;

    try {
      await runOneIteration(ctx, session, persona, signal);
    } catch (err) {
      stepError = err instanceof Error ? err : new Error(String(err));
    }

    if (signal.aborted) return;

    // Advance regardless of success — the loop should keep moving so the user
    // doesn't get stuck on a flaky persona forever.
    const after = ctx.store.autopilotSessions.findById(session.id);
    if (!after) return;
    const advanced = ctx.store.autopilotSessions.update(session.id, {
      cycleIndex: after.cycleIndex + 1,
      currentChildRunId: null,
    });
    ctx.notify(advanced);

    if (stepError) {
      // Record a "skipped" entry so the user sees the gap.
      const entry: AutopilotChildEntry = {
        issueNumber: -1,
        runId: null,
        kind: 'feat',
        status: 'skipped',
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        persona: persona.name,
        title: '(failed to ideate or dispatch)',
        note: stepError.message,
      };
      const withChild = ctx.store.autopilotSessions.appendChild(session.id, entry);
      ctx.notify(withChild);
    }

    // Tiny pause to keep the supervisor loop fresh and let the UI catch up.
    await sleepInterruptible(500, signal);
  }
}

async function runOneIteration(
  ctx: OrchestratorContext,
  session: AutopilotSession,
  persona: AutopilotPersonaSnapshot,
  signal: AbortSignal,
): Promise<void> {
  const backlog = await buildBacklog(ctx);

  const drafted = await ctx.suggestIssue({
    backlog,
    personaPrompt: persona.prompt,
  });
  if (signal.aborted) return;

  const issue = await ctx.source.createIssue({
    title: drafted.title,
    body: drafted.body,
    labels: ['type:feat', 'status:in-progress', `parent:${session.issueNumber}`],
  });
  if (signal.aborted) return;

  const thread = ctx.store.threads.getOrCreate({
    repoOwner: ctx.repoConfig.owner,
    repoName: ctx.repoConfig.repo,
    issueNumber: issue.number,
  });

  const run = await dispatchAutopilotChild(
    { supervisor: ctx.supervisor },
    { issue, threadId: thread.id },
  );

  ctx.setCurrentChildRunId(session.id, run.id);

  const childEntry: AutopilotChildEntry = {
    issueNumber: issue.number,
    runId: run.id,
    kind: 'feat',
    status: 'running',
    createdAt: run.startedAt,
    endedAt: null,
    persona: persona.name,
    title: drafted.title,
  };
  const withChild = ctx.store.autopilotSessions.appendChild(session.id, childEntry);
  ctx.notify(withChild);

  const settled = await waitForChildSettled(ctx.supervisor, ctx.store, run.id, signal);
  const childStatus: AutopilotChildStatus =
    settled.dismissedDecision && settled.finalStatus === 'awaiting_input'
      ? 'skipped'
      : settled.finalStatus;
  const updated = ctx.store.autopilotSessions.updateChildByIssueNumber(
    session.id,
    issue.number,
    {
      status: childStatus,
      endedAt: new Date().toISOString(),
    },
  );
  ctx.notify(updated);
}

async function buildBacklog(
  ctx: OrchestratorContext,
): Promise<Array<{ title: string; body?: string }>> {
  const issues = await ctx.source.listIssues({ state: 'open' });
  return issues
    .filter((issue) => statusFromLabels(issue.labels) === 'backlog')
    .slice(0, BACKLOG_SAMPLE_LIMIT)
    .map((issue) => {
      const entry: { title: string; body?: string } = { title: issue.title };
      if (issue.body) entry.body = issue.body;
      return entry;
    });
}

function sleepInterruptible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
