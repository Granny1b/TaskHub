import type { TaskDocument, TaskList, TaskNode, TaskSummary } from '@taskhub/shared';

/**
 * The HTTP client.
 *
 * Two things it does that a plain `fetch` wrapper would not:
 *
 * 1. **It carries ETags.** Every read returns the document *and* its ETag, and
 *    every write sends one back. The server refuses a write without `If-Match`
 *    (428), so an ETag is not optional bookkeeping — it is part of the request.
 *
 * 2. **It turns problem+json into typed errors.** The client branches on
 *    `ApiError.type`, never on a message, because messages are translated.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null, message?: string) {
    super(message ?? problem?.detail ?? problem?.title ?? `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.type = problem?.type ?? 'unknown';
    this.problem = problem;
  }

  /** Someone else changed this while the user was working on it. */
  get isConflict(): boolean {
    return this.status === 409 || this.type === 'concurrency_conflict';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Signed in, but not on the allowlist. On the Free tier this is expected. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** A payload together with the concurrency token that guards it. */
export interface WithETag<T> {
  readonly data: T;
  readonly etag: string;
}

const BASE_URL = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

interface RequestOptions {
  method?: string;
  body?: unknown;
  ifMatch?: string | null;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<WithETag<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.ifMatch !== undefined && options.ifMatch !== null && options.ifMatch.length > 0) {
    headers['If-Match'] = options.ifMatch;
  }

  const response = await fetch(`${BASE_URL}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    // SWA puts the session cookie on the same origin.
    credentials: 'same-origin',
  });

  if (!response.ok) {
    let problem: ProblemDetails | null = null;
    try {
      const text = await response.text();
      if (text.length > 0) problem = JSON.parse(text) as ProblemDetails;
    } catch {
      problem = null;
    }
    throw new ApiError(response.status, problem);
  }

  const etag = response.headers.get('etag') ?? '';

  if (response.status === 204) {
    return { data: undefined as T, etag };
  }

  const data = (await response.json()) as T;
  return { data, etag };
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export interface TaskFilter {
  /** `null` means ungrouped; omit for every list. */
  listId?: string | null;
  isComplete?: boolean;
  q?: string;
}

function taskQuery(filter: TaskFilter): string {
  const params = new URLSearchParams();
  if (filter.listId !== undefined) params.set('listId', filter.listId ?? 'none');
  if (filter.isComplete !== undefined) params.set('isComplete', String(filter.isComplete));
  if (filter.q !== undefined && filter.q.length > 0) params.set('q', filter.q);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export interface PatchNode {
  title?: string;
  date?: string;
  comments?: string;
  isComplete?: boolean;
  percent?: number;
  percentSource?: 'manual' | 'derived';
  completedDate?: string | null;
}

export const api = {
  async me(): Promise<{ userId: string; userDetails: string; roles: string[] }> {
    const { data } = await request<{ userId: string; userDetails: string; roles: string[] }>('/me');
    return data;
  },

  async listTasks(filter: TaskFilter = {}): Promise<TaskSummary[]> {
    const { data } = await request<{ tasks: TaskSummary[] }>(`/tasks${taskQuery(filter)}`);
    return data.tasks;
  },

  async getTask(id: string): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>(`/tasks/${id}`);
  },

  async createTask(input: {
    title: string;
    date?: string;
    comments?: string;
    listId?: string | null;
  }): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>('/tasks', { method: 'POST', body: input });
  },

  async patchTask(
    id: string,
    patch: { node?: PatchNode; listId?: string | null },
    ifMatch: string,
  ): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>(`/tasks/${id}`, { method: 'PATCH', body: patch, ifMatch });
  },

  async deleteTask(id: string, ifMatch: string): Promise<WithETag<TaskSummary>> {
    return request<TaskSummary>(`/tasks/${id}`, { method: 'DELETE', ifMatch });
  },

  async addChild(
    id: string,
    input: { title: string; date?: string; comments?: string; parentId?: string },
    ifMatch: string,
  ): Promise<WithETag<{ child: TaskNode; task: TaskDocument }>> {
    return request<{ child: TaskNode; task: TaskDocument }>(`/tasks/${id}/children`, {
      method: 'POST',
      body: input,
      ifMatch,
    });
  },

  async patchChild(
    id: string,
    childId: string,
    patch: PatchNode,
    ifMatch: string,
  ): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>(`/tasks/${id}/children/${childId}`, {
      method: 'PATCH',
      body: patch,
      ifMatch,
    });
  },

  async removeChild(id: string, childId: string, ifMatch: string): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>(`/tasks/${id}/children/${childId}`, {
      method: 'DELETE',
      ifMatch,
    });
  },

  async reorderChildren(
    id: string,
    input: { movedId: string; toIndex: number; parentId?: string },
    ifMatch: string,
  ): Promise<WithETag<TaskDocument>> {
    return request<TaskDocument>(`/tasks/${id}/reorder`, { method: 'POST', body: input, ifMatch });
  },

  /* ---------------------------------------------------------------------- */
  /* Lists                                                                   */
  /* ---------------------------------------------------------------------- */

  async getLists(): Promise<WithETag<TaskList[]>> {
    const { data, etag } = await request<{ lists: TaskList[] }>('/lists');
    return { data: data.lists, etag };
  },

  async createList(
    input: { name: string; colorToken?: string | null },
    ifMatch: string | null,
  ): Promise<WithETag<{ list: TaskList }>> {
    return request<{ list: TaskList }>('/lists', { method: 'POST', body: input, ifMatch });
  },

  async patchList(
    id: string,
    patch: { name?: string; colorToken?: string | null },
    ifMatch: string,
  ): Promise<WithETag<{ lists: TaskList[] }>> {
    return request<{ lists: TaskList[] }>(`/lists/${id}`, {
      method: 'PATCH',
      body: patch,
      ifMatch,
    });
  },

  async deleteList(id: string, ifMatch: string): Promise<WithETag<{ lists: TaskList[] }>> {
    return request<{ lists: TaskList[] }>(`/lists/${id}`, { method: 'DELETE', ifMatch });
  },

  async reorderLists(
    input: { movedId: string; toIndex: number },
    ifMatch: string,
  ): Promise<WithETag<{ lists: TaskList[] }>> {
    return request<{ lists: TaskList[] }>('/lists/reorder', {
      method: 'POST',
      body: input,
      ifMatch,
    });
  },
};
