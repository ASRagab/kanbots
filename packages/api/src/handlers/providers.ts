import { existsSync } from 'node:fs';
import { validateProvider, type ProviderCredentials } from '@kanbots/llm';
import type { ProviderId } from '@kanbots/local-store';
import { z } from 'zod';
import type {
  ProviderSaveInput,
  ProviderSettingsInput,
  ProviderTestConnectionResult,
  ProvidersPayload,
} from '../bridge.js';
import { badRequest, parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const PROVIDER_ID_SCHEMA = z.enum(['claude-code', 'codex-cli']);

const saveSchema = z
  .object({
    id: PROVIDER_ID_SCHEMA,
    enabled: z.boolean().optional(),
    defaultModel: z.string().min(1).max(120).nullable().optional(),
    apiKey: z.string().min(1).max(2_000).nullable().optional(),
  })
  .strict();

const testSchema = z
  .object({
    id: PROVIDER_ID_SCHEMA,
    apiKey: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const setDefaultsSchema = z
  .object({
    defaultProvider: PROVIDER_ID_SCHEMA.nullable().optional(),
    defaultModel: z.string().min(1).max(120).nullable().optional(),
  })
  .strict();

export async function getConfig(deps: HandlerDeps): Promise<ProvidersPayload> {
  return readPayload(deps);
}

export async function save(
  deps: HandlerDeps,
  args: ProviderSaveInput,
): Promise<ProvidersPayload> {
  const parsed = parseArgs(saveSchema, args);
  const id = parsed.id as ProviderId;

  // Both supported providers manage their own credentials externally:
  // claude-code via OAuth, codex-cli via `codex login` / OPENAI_API_KEY.
  // The app never stores API keys.
  if (parsed.apiKey !== undefined && parsed.apiKey !== null && parsed.apiKey !== '') {
    throw badRequest(
      `${id} does not accept an API key here. ${
        id === 'claude-code'
          ? 'Sign in via the desktop app.'
          : 'Use `codex login` or set OPENAI_API_KEY in your environment.'
      }`,
    );
  }

  const patch: Parameters<typeof deps.store.providers.update>[1] = {};
  if (parsed.enabled !== undefined) patch.enabled = parsed.enabled;
  if (parsed.defaultModel !== undefined) patch.defaultModel = parsed.defaultModel;
  deps.store.providers.update(id, patch);
  return readPayload(deps);
}

export async function testConnection(
  deps: HandlerDeps,
  args: { id: ProviderId; apiKey?: string },
): Promise<ProviderTestConnectionResult> {
  const parsed = parseArgs(testSchema, args);
  const id = parsed.id as ProviderId;

  let creds: ProviderCredentials;
  if (id === 'claude-code') {
    creds = {
      kind: 'claude-code-oauth',
      credentialsPath: claudeCodeCredentialsPath(),
    };
  } else {
    // codex-cli: validate is a no-op; the adapter doesn't read creds.
    creds = { kind: 'api-key', apiKey: '' };
  }

  const result = await validateProvider(id, creds);
  deps.store.providers.update(id, {
    lastValidatedAt: new Date().toISOString(),
    lastError: result.ok ? null : (result.error ?? 'unknown error'),
  });
  return {
    ok: result.ok,
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.models !== undefined ? { models: result.models } : {}),
  };
}

export async function setDefaults(
  deps: HandlerDeps,
  args: ProviderSettingsInput,
): Promise<ProvidersPayload> {
  const parsed = parseArgs(setDefaultsSchema, args);
  const patch: Parameters<typeof deps.store.providerSettings.update>[0] = {};
  if (parsed.defaultProvider !== undefined) {
    patch.defaultProvider = (parsed.defaultProvider as ProviderId | null) ?? null;
  }
  if (parsed.defaultModel !== undefined) patch.defaultModel = parsed.defaultModel;
  deps.store.providerSettings.update(patch);
  return readPayload(deps);
}

function readPayload(deps: HandlerDeps): ProvidersPayload {
  const rows = deps.store.providers.list();
  const settings = deps.store.providerSettings.get();

  const providers = rows.map((row) => ({
    id: row.id,
    enabled: row.enabled,
    hasKey:
      row.id === 'claude-code'
        ? deps.providers.hasClaudeCodeCredentials()
        : hasCodexCliCredentials(),
    defaultModel: row.defaultModel,
    keyEncryption: row.keyEncryption,
    lastValidatedAt: row.lastValidatedAt,
    lastError: row.lastError,
  }));

  // `hasKey` reflects detected CLI credentials (~/.claude/.credentials.json,
  // ~/.codex/auth.json, or OPENAI_API_KEY). If either CLI is signed in we
  // treat the app as configured even when the provider row hasn't been
  // explicitly toggled on — the supervisor falls back to claude-code and the
  // overlay is just there to nudge first-time users.
  const anyConfigured = providers.some((p) => p.hasKey);

  return {
    providers,
    settings: {
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
    },
    safeStorageAvailable: deps.providers.safeStorageAvailable(),
    anyConfigured,
  };
}

function hasCodexCliCredentials(): boolean {
  // codex finds its own auth — `codex login` writes ~/.codex/auth.json,
  // or OPENAI_API_KEY can be set in the ambient environment.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home && existsSync(`${home}/.codex/auth.json`)) return true;
  if (process.env.OPENAI_API_KEY) return true;
  return false;
}

function claudeCodeCredentialsPath(): string {
  // Mirror packages/desktop/src/claude-auth.ts (CLAUDE_CREDENTIALS_PATH).
  // We can't import from desktop here, but the path is stable.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.claude/.credentials.json`;
}
