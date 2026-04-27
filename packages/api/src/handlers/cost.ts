import type { CostTodayResult } from '../bridge.js';
import type { HandlerDeps } from './types.js';

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function today(deps: HandlerDeps): Promise<CostTodayResult> {
  const since = startOfTodayIso();
  const totalUsd = deps.store.agentRuns.sumCostSince(since);
  return { totalUsd, since };
}
