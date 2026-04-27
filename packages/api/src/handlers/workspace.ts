import { z } from 'zod';
import type { Workspace, WorkspaceFolderPayload } from '../bridge.js';
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
