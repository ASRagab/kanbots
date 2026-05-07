/**
 * Typed HTTP client for the Kanbots Cloud v1 API. Uses a user-scoped
 * bearer token (kind='user' agent_token) so it can act on behalf of
 * the signed-in user across all their orgs — same authority as the
 * Clerk session in the browser.
 */

import { CloudClientError, bypassHeaders, request, type CloudClientOptions } from './http.js';
import type {
  AgentRunListResponse,
  AgentRunSummary,
  AttachmentListResponse,
  AttachmentSummary,
  CardListResponse,
  CardSummary,
  CommentListResponse,
  CommentSummary,
  CreateAgentRunRequest,
  CreateCardRequest,
  CreateOrgRequest,
  CreateOrgResponse,
  CreateProjectRequest,
  ListCardsQuery,
  OrgListResponse,
  ProjectListResponse,
  ProjectSummary,
  UpdateCardRequest,
  UserMe,
} from './types.js';

export type { CloudClientOptions } from './http.js';
export { CloudClientError } from './http.js';
export type * from './types.js';

export interface CloudClient {
  users: {
    me(): Promise<UserMe>;
  };
  orgs: {
    list(opts?: { cursor?: string; limit?: number }): Promise<OrgListResponse>;
    create(body: CreateOrgRequest): Promise<CreateOrgResponse>;
  };
  projects: {
    list(orgSlug: string): Promise<ProjectListResponse>;
    create(orgSlug: string, body: CreateProjectRequest): Promise<ProjectSummary>;
  };
  cards: {
    list(
      orgSlug: string,
      projectSlug: string,
      query?: ListCardsQuery,
    ): Promise<CardListResponse>;
    get(orgSlug: string, projectSlug: string, number: number): Promise<CardSummary>;
    create(
      orgSlug: string,
      projectSlug: string,
      body: CreateCardRequest,
    ): Promise<CardSummary>;
    update(
      orgSlug: string,
      projectSlug: string,
      number: number,
      body: UpdateCardRequest,
      opts?: { ifMatch?: string },
    ): Promise<CardSummary>;
  };
  comments: {
    list(
      orgSlug: string,
      projectSlug: string,
      number: number,
    ): Promise<CommentListResponse>;
    add(
      orgSlug: string,
      projectSlug: string,
      number: number,
      body: string,
    ): Promise<CommentSummary>;
    delete(orgSlug: string, commentId: string): Promise<void>;
  };
  attachments: {
    list(
      orgSlug: string,
      projectSlug: string,
      number: number,
    ): Promise<AttachmentListResponse>;
    upload(
      orgSlug: string,
      projectSlug: string,
      number: number,
      file: { filename: string; contentType: string; bytes: Uint8Array | Blob },
    ): Promise<AttachmentSummary>;
  };
  runs: {
    listForCard(
      orgSlug: string,
      projectSlug: string,
      number: number,
    ): Promise<AgentRunListResponse>;
    create(
      orgSlug: string,
      projectSlug: string,
      number: number,
      body: CreateAgentRunRequest,
    ): Promise<AgentRunSummary>;
    get(orgSlug: string, projectSlug: string, runId: string): Promise<AgentRunSummary>;
    /**
     * Subscribe to NDJSON / SSE events for a run. Yields raw event
     * payloads (already JSON-parsed); caller re-narrows. Resumes via
     * Last-Event-ID when reconnecting.
     */
    stream(
      orgSlug: string,
      projectSlug: string,
      runId: string,
      opts?: { lastEventId?: string; signal?: AbortSignal },
    ): AsyncIterable<{ id: string; event: string; data: unknown }>;
  };
}

function encodeStatusFilter(values: ListCardsQuery['status']): string | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return values.join(',');
}

function bodyToFormData(file: {
  filename: string;
  contentType: string;
  bytes: Uint8Array | Blob;
}): FormData {
  const fd = new FormData();
  let blob: Blob;
  if (file.bytes instanceof Blob) {
    blob = file.bytes;
  } else {
    // Copy into a fresh ArrayBuffer so the BlobPart typing matches —
    // a Uint8Array view backed by SharedArrayBuffer is not assignable
    // even though it works at runtime.
    const ab = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    blob = new Blob([ab], { type: file.contentType });
  }
  fd.append('file', blob, file.filename);
  return fd;
}

export function createCloudClient(opts: CloudClientOptions): CloudClient {
  return {
    users: {
      me: () => request<UserMe>(opts, { method: 'GET', path: '/api/v1/users/me' }),
    },
    orgs: {
      list: (q) => {
        const query: Record<string, string | number | boolean | undefined | null> = {};
        if (q?.cursor !== undefined) query.cursor = q.cursor;
        if (q?.limit !== undefined) query.limit = q.limit;
        return request<OrgListResponse>(opts, {
          method: 'GET',
          path: '/api/v1/orgs',
          query,
        });
      },
      create: (body) =>
        request<CreateOrgResponse>(opts, {
          method: 'POST',
          path: '/api/v1/orgs',
          body,
        }),
    },
    projects: {
      list: (orgSlug) =>
        request<ProjectListResponse>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects`,
        }),
      create: (orgSlug, body) =>
        request<ProjectSummary>(opts, {
          method: 'POST',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects`,
          body,
        }),
    },
    cards: {
      list: (orgSlug, projectSlug, query) => {
        const q: Record<string, string | number | boolean | undefined | null> = {};
        if (query?.cursor !== undefined) q.cursor = query.cursor;
        if (query?.limit !== undefined) q.limit = query.limit;
        if (query?.assignee_user_id !== undefined) q.assignee_user_id = query.assignee_user_id;
        if (query?.include_archived !== undefined) q.include_archived = query.include_archived;
        const status = encodeStatusFilter(query?.status);
        if (status !== undefined) q.status = status;
        return request<CardListResponse>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards`,
          query: q,
        });
      },
      get: (orgSlug, projectSlug, number) =>
        request<CardSummary>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}`,
        }),
      create: (orgSlug, projectSlug, body) =>
        request<CardSummary>(opts, {
          method: 'POST',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards`,
          body,
        }),
      update: (orgSlug, projectSlug, number, body, ro) =>
        request<CardSummary>(opts, {
          method: 'PATCH',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}`,
          body,
          ...(ro?.ifMatch !== undefined ? { ifMatch: ro.ifMatch } : {}),
        }),
    },
    comments: {
      list: (orgSlug, projectSlug, number) =>
        request<CommentListResponse>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/comments`,
        }),
      add: (orgSlug, projectSlug, number, bodyText) =>
        request<CommentSummary>(opts, {
          method: 'POST',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/comments`,
          body: { body: bodyText },
        }),
      delete: (orgSlug, commentId) =>
        request<void>(opts, {
          method: 'DELETE',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/comments/${encodeURIComponent(commentId)}`,
        }),
    },
    attachments: {
      list: (orgSlug, projectSlug, number) =>
        request<AttachmentListResponse>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/attachments`,
        }),
      upload: (orgSlug, projectSlug, number, file) =>
        request<AttachmentSummary>(opts, {
          method: 'POST',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/attachments`,
          rawBody: bodyToFormData(file),
        }),
    },
    runs: {
      listForCard: (orgSlug, projectSlug, number) =>
        request<AgentRunListResponse>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/runs`,
        }),
      create: (orgSlug, projectSlug, number, body) =>
        request<AgentRunSummary>(opts, {
          method: 'POST',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/cards/${number}/runs`,
          body,
        }),
      get: (orgSlug, projectSlug, runId) =>
        request<AgentRunSummary>(opts, {
          method: 'GET',
          path: `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/runs/${encodeURIComponent(runId)}`,
        }),
      stream: (orgSlug, projectSlug, runId, streamOpts) =>
        streamRunEvents(opts, orgSlug, projectSlug, runId, streamOpts),
    },
  };
}

/**
 * Reads the SSE stream for a run and yields parsed events. The
 * stream uses the standard `event: <name>\ndata: <json>\n\n`
 * format; we surface `id` separately so the caller can resume via
 * Last-Event-ID after a disconnect.
 */
async function* streamRunEvents(
  opts: CloudClientOptions,
  orgSlug: string,
  projectSlug: string,
  runId: string,
  streamOpts: { lastEventId?: string; signal?: AbortSignal } | undefined,
): AsyncIterable<{ id: string; event: string; data: unknown }> {
  const baseUrl = await opts.getBaseUrl();
  const token = await opts.getToken();
  if (token === null) throw new CloudClientError('UNAUTHENTICATED', 0);

  const url = new URL(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/runs/${encodeURIComponent(runId)}/stream`,
    baseUrl,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'text/event-stream',
    ...(await bypassHeaders(opts)),
  };
  if (streamOpts?.lastEventId !== undefined) {
    headers['last-event-id'] = streamOpts.lastEventId;
  }

  const fetchFn = opts.fetch ?? globalThis.fetch;
  const init: RequestInit = { method: 'GET', headers };
  if (streamOpts?.signal !== undefined) init.signal = streamOpts.signal;
  const res = await fetchFn(url, init);
  if (!res.ok || res.body === null) {
    throw new CloudClientError(`STREAM_${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseSseBlock(block);
      if (ev !== null) yield ev;
    }
  }
}

function parseSseBlock(
  block: string,
): { id: string; event: string; data: unknown } | null {
  let id = '';
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith(':') || line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const val = line.slice(colon + 1).trimStart();
    if (field === 'id') id = val;
    else if (field === 'event') event = val;
    else if (field === 'data') data += (data.length > 0 ? '\n' : '') + val;
  }
  if (data.length === 0 && id.length === 0) return null;
  let parsed: unknown = data;
  try {
    parsed = JSON.parse(data);
  } catch {
    // leave as string if not JSON
  }
  return { id, event, data: parsed };
}
