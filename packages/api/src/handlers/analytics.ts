import { z } from 'zod';
import { parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const repoFilter = {
  repoOwner: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
} as const;

const rollupSchema = z
  .object({
    ...repoFilter,
    sinceTs: z.string().datetime().optional(),
    cardKind: z.string().optional(),
    cardSizeBucket: z.string().optional(),
  })
  .strict();

const timeSeriesSchema = z
  .object({
    ...repoFilter,
    sinceTs: z.string().datetime(),
    personaId: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

const frontierSchema = z
  .object({
    ...repoFilter,
    sinceTs: z.string().datetime().optional(),
    minRuns: z.number().int().positive().max(100).optional(),
  })
  .strict();

export type RollupArgs = z.infer<typeof rollupSchema>;
export type TimeSeriesArgs = z.infer<typeof timeSeriesSchema>;
export type FrontierArgs = z.infer<typeof frontierSchema>;

export interface PersonaModelRollupRow {
  personaId: string;
  model: string | null;
  provider: string | null;
  runs: number;
  successes: number;
  failures: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgDurationMs: number | null;
  successRate: number;
}

export interface CostTimeSeriesPoint {
  bucketDate: string;
  runs: number;
  totalCostUsd: number;
  successRate: number;
}

export interface FrontierPoint {
  personaId: string;
  model: string | null;
  provider: string | null;
  runs: number;
  avgCostUsd: number;
  successRate: number;
}

function buildRollupOpts(parsed: RollupArgs): Parameters<
  HandlerDeps['store']['agentRuns']['personaModelRollup']
>[0] {
  const opts: Parameters<HandlerDeps['store']['agentRuns']['personaModelRollup']>[0] = {};
  if (parsed.repoOwner !== undefined) opts.repoOwner = parsed.repoOwner;
  if (parsed.repoName !== undefined) opts.repoName = parsed.repoName;
  if (parsed.sinceTs !== undefined) opts.sinceTs = parsed.sinceTs;
  if (parsed.cardKind !== undefined) opts.cardKind = parsed.cardKind;
  if (parsed.cardSizeBucket !== undefined) opts.cardSizeBucket = parsed.cardSizeBucket;
  return opts;
}

export async function rollup(
  deps: HandlerDeps,
  args: RollupArgs,
): Promise<PersonaModelRollupRow[]> {
  const parsed = parseArgs(rollupSchema, args);
  return deps.store.agentRuns.personaModelRollup(buildRollupOpts(parsed));
}

export async function timeSeries(
  deps: HandlerDeps,
  args: TimeSeriesArgs,
): Promise<CostTimeSeriesPoint[]> {
  const parsed = parseArgs(timeSeriesSchema, args);
  const opts: Parameters<HandlerDeps['store']['agentRuns']['costTimeSeries']>[0] = {
    sinceTs: parsed.sinceTs,
  };
  if (parsed.repoOwner !== undefined) opts.repoOwner = parsed.repoOwner;
  if (parsed.repoName !== undefined) opts.repoName = parsed.repoName;
  if (parsed.personaId !== undefined) opts.personaId = parsed.personaId;
  if (parsed.model !== undefined) opts.model = parsed.model;
  return deps.store.agentRuns.costTimeSeries(opts);
}

export async function frontier(
  deps: HandlerDeps,
  args: FrontierArgs,
): Promise<FrontierPoint[]> {
  const parsed = parseArgs(frontierSchema, args);
  const opts: Parameters<HandlerDeps['store']['agentRuns']['frontierData']>[0] = {};
  if (parsed.repoOwner !== undefined) opts.repoOwner = parsed.repoOwner;
  if (parsed.repoName !== undefined) opts.repoName = parsed.repoName;
  if (parsed.sinceTs !== undefined) opts.sinceTs = parsed.sinceTs;
  if (parsed.minRuns !== undefined) opts.minRuns = parsed.minRuns;
  return deps.store.agentRuns.frontierData(opts);
}
