import { z } from 'zod';
import type { ResolveCardResult } from '../bridge.js';
import { badRequest, namedError, notFound, parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const resolveSchema = z
  .object({
    cardId: z.number().int().positive(),
    value: z.string().min(1).max(2000),
  })
  .strict();

export interface ResolveCardArgs {
  cardId: number;
  value: string;
}

export async function resolve(
  deps: HandlerDeps,
  args: ResolveCardArgs,
): Promise<ResolveCardResult> {
  const parsed = parseArgs(resolveSchema, args);

  const card = deps.store.cards.findById(parsed.cardId);
  if (!card) throw notFound(`card ${parsed.cardId} not found`);
  if (card.type !== 'decision') {
    throw badRequest('card type not resolvable here');
  }
  const payload = card.payload as
    | { question?: string; options?: Array<{ value: string; label: string }> }
    | undefined;
  const options = payload?.options ?? [];
  const chosen = options.find((o) => o.value === parsed.value);
  if (!chosen) throw badRequest('value not in options');

  const message = deps.store.messages.findById(card.messageId);
  if (!message || message.agentRunId === null) {
    throw namedError('InternalError', 'card not linked to an agent run');
  }
  const runId = message.agentRunId;

  const resolved = deps.store.cards.resolve(card.id, {
    value: parsed.value,
    label: chosen.label,
  });

  const resumePrompt = `User chose: ${chosen.label} (value: ${parsed.value}). Continue.`;
  const run = await deps.supervisor.resume({ runId, prompt: resumePrompt });

  return { card: resolved, run };
}
