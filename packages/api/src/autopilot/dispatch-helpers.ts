import type { Issue } from '@kanbots/core';
import type { AgentRun } from '@kanbots/local-store';
import type { AgentSupervisor } from '../agent-runs/supervisor.js';
import { buildTaskSystemPrompt } from '../handlers/issues.js';

export interface DispatchAutopilotChildDeps {
  supervisor: AgentSupervisor;
}

export interface DispatchAutopilotChildArgs {
  issue: Pick<Issue, 'number' | 'title' | 'body'>;
  threadId: number;
  model?: string;
}

export async function dispatchAutopilotChild(
  deps: DispatchAutopilotChildDeps,
  args: DispatchAutopilotChildArgs,
): Promise<AgentRun> {
  const kickoff = buildAutopilotKickoff(args.issue);
  const startInput: Parameters<AgentSupervisor['start']>[0] = {
    threadId: args.threadId,
    issueNumber: args.issue.number,
    prompt: kickoff,
    appendSystemPrompt: buildTaskSystemPrompt({
      number: args.issue.number,
      title: args.issue.title,
      body: args.issue.body,
    }),
  };
  if (args.model !== undefined) startInput.model = args.model;
  return deps.supervisor.start(startInput);
}

function buildAutopilotKickoff(issue: {
  number: number;
  title: string;
  body: string | null | undefined;
}): string {
  const body = issue.body && issue.body.trim().length > 0 ? issue.body : '(no description)';
  return `Task #${issue.number}: ${issue.title}

${body}

This task was created by an autopilot loop and is delegated to you to ship end-to-end. Proceed directly — do not emit a kanbots-decision asking how to approach. Investigate the codebase, make the change, run any checks you have available, and finish when the task is complete.`;
}
