import { z } from 'zod';
import { HOUSE_RULES_MAX_BYTES } from '@kanbots/local-store';
import type {
  Workspace,
  WorkspaceBudgets,
  WorkspaceFolderPayload,
  WorkspaceHouseRules,
} from '../bridge.js';
import { bootstrapWorkspace } from '../workspace-bootstrap.js';
import { badRequest, parseArgs } from './errors.js';
import type { HandlerDeps } from './types.js';

const addFolderSchema = z
  .object({
    name: z.string().min(1).max(120),
    path: z.string().min(1).max(2048),
    defaultBranch: z.string().min(1).max(120).optional(),
  })
  .strict();

export interface AddFolderArgs {
  name: string;
  path: string;
  defaultBranch?: string;
}

export async function getWorkspace(deps: HandlerDeps): Promise<Workspace> {
  if (!deps.config.repoPath) {
    return { id: 'default', name: 'kanbots workspace', currentFolderId: 'unknown' };
  }
  const { workspace, currentFolder } = bootstrapWorkspace(
    deps.store,
    deps.config,
    deps.config.repoPath,
  );
  return {
    id: workspace.id,
    name: workspace.name,
    currentFolderId: currentFolder.id,
  };
}

export async function listFolders(
  deps: HandlerDeps,
): Promise<WorkspaceFolderPayload[]> {
  if (!deps.config.repoPath) return [];
  const { workspace, currentFolder } = bootstrapWorkspace(
    deps.store,
    deps.config,
    deps.config.repoPath,
  );
  const rows = deps.store.folders.listByWorkspace(workspace.id);
  return rows.map((f) => ({
    id: f.id,
    workspaceId: f.workspaceId,
    name: f.name,
    path: f.path,
    defaultBranch: f.defaultBranch,
    addedAt: f.addedAt,
    current: f.id === currentFolder.id,
  }));
}

const setBudgetsSchema = z
  .object({
    runCostBudgetUsd: z.number().positive().nullable(),
    sessionCostBudgetUsd: z.number().positive().nullable(),
  })
  .strict();

export async function getBudgets(deps: HandlerDeps): Promise<WorkspaceBudgets> {
  if (!deps.budgets) {
    return { runCostBudgetUsd: null, sessionCostBudgetUsd: null };
  }
  return deps.budgets.get();
}

export async function setBudgets(
  deps: HandlerDeps,
  args: WorkspaceBudgets,
): Promise<WorkspaceBudgets> {
  const parsed = parseArgs(setBudgetsSchema, args);
  if (!deps.budgets) {
    throw badRequest('host has no active workspace');
  }
  await deps.budgets.set(parsed);
  return deps.budgets.get();
}

const setHouseRulesSchema = z
  .object({
    houseRules: z.string().nullable(),
  })
  .strict();

export async function getHouseRules(deps: HandlerDeps): Promise<WorkspaceHouseRules> {
  if (!deps.houseRules) return { houseRules: null };
  return deps.houseRules.get();
}

export async function setHouseRules(
  deps: HandlerDeps,
  args: WorkspaceHouseRules,
): Promise<WorkspaceHouseRules> {
  const parsed = parseArgs(setHouseRulesSchema, args);
  if (!deps.houseRules) throw badRequest('host has no active workspace');
  let next: string | null;
  if (parsed.houseRules === null) {
    next = null;
  } else {
    const trimmed = parsed.houseRules.trim();
    if (trimmed.length === 0) {
      next = null;
    } else if (Buffer.byteLength(trimmed, 'utf8') > HOUSE_RULES_MAX_BYTES) {
      throw badRequest(`houseRules exceeds ${HOUSE_RULES_MAX_BYTES} bytes`);
    } else {
      next = trimmed;
    }
  }
  await deps.houseRules.set({ houseRules: next });
  return deps.houseRules.get();
}

export async function addFolder(
  deps: HandlerDeps,
  args: AddFolderArgs,
): Promise<WorkspaceFolderPayload> {
  const parsed = parseArgs(addFolderSchema, args);
  if (!deps.config.repoPath) {
    throw badRequest('host has no active workspace');
  }
  const { workspace } = bootstrapWorkspace(
    deps.store,
    deps.config,
    deps.config.repoPath,
  );
  const id = `manual-${Date.now()}`;
  const folder = deps.store.folders.ensure({
    id,
    workspaceId: workspace.id,
    name: parsed.name,
    path: parsed.path,
    ...(parsed.defaultBranch !== undefined
      ? { defaultBranch: parsed.defaultBranch }
      : {}),
  });
  return {
    id: folder.id,
    workspaceId: folder.workspaceId,
    name: folder.name,
    path: folder.path,
    defaultBranch: folder.defaultBranch,
    addedAt: folder.addedAt,
    current: false,
  };
}
