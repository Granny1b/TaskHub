import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import {
  createContext,
  reorderChildren,
  setComplete,
  setCompletedDate,
  setPercent,
  setPercentToAuto,
  updateNode,
  type TaskDocument,
  type TaskList,
  type TaskSummary,
} from '@taskhub/shared';
import { ApiError, api, type PatchNode, type TaskFilter, type WithETag } from './apiClient.js';
import { analyseConflict, type PendingConflict } from './conflict.js';

/**
 * Server state lives in TanStack Query. There is no client-side store of task
 * data, because there is no client-owned task state — every fact about a task
 * comes from the server, guarded by an ETag.
 *
 * Each cached task is stored as `{ data, etag }` together, so a mutation can
 * never accidentally send an ETag belonging to a different version.
 */

export const queryKeys = {
  me: ['me'] as const,
  lists: ['lists'] as const,
  tasks: (filter: TaskFilter) => ['tasks', filter] as const,
  task: (id: string) => ['task', id] as const,
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.me(),
    // Identity does not change during a session.
    staleTime: Infinity,
    retry: false,
  });
}

export function useLists() {
  return useQuery({
    queryKey: queryKeys.lists,
    queryFn: () => api.getLists(),
    staleTime: 30_000,
  });
}

export function useTasks(filter: TaskFilter): UseQueryResult<TaskSummary[]> {
  return useQuery({
    queryKey: queryKeys.tasks(filter),
    queryFn: () => api.listTasks(filter),
    staleTime: 5_000,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: queryKeys.task(id ?? ''),
    queryFn: () => api.getTask(id as string),
    enabled: id !== null && id.length > 0,
    staleTime: 5_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Cache maintenance                                                           */
/* -------------------------------------------------------------------------- */

function cacheTask(client: QueryClient, saved: WithETag<TaskDocument>): void {
  client.setQueryData(queryKeys.task(saved.data.id), saved);
}

/** The list view is a projection of tasks, so any task write invalidates it. */
function invalidateTaskLists(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['tasks'] });
}

/* -------------------------------------------------------------------------- */
/* Task mutations                                                              */
/* -------------------------------------------------------------------------- */

export function useCreateTask() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: { title: string; comments?: string; listId?: string | null }) =>
      api.createTask(input),
    onSuccess: (saved) => {
      cacheTask(client, saved);
      invalidateTaskLists(client);
    },
  });
}

export function useDeleteTask() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, etag }: { id: string; etag: string }) => api.deleteTask(id, etag),
    onSuccess: (_result, variables) => {
      client.removeQueries({ queryKey: queryKeys.task(variables.id) });
      invalidateTaskLists(client);
    },
  });
}

export function useAddChild() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      etag,
      title,
      parentId,
    }: {
      id: string;
      etag: string;
      title: string;
      parentId?: string;
    }) => api.addChild(id, { title, ...(parentId !== undefined ? { parentId } : {}) }, etag),
    onSuccess: (saved) => {
      cacheTask(client, { data: saved.data.task, etag: saved.etag });
      invalidateTaskLists(client);
    },
  });
}

export function useRemoveChild() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, childId, etag }: { id: string; childId: string; etag: string }) =>
      api.removeChild(id, childId, etag),
    onSuccess: (saved) => {
      cacheTask(client, saved);
      invalidateTaskLists(client);
    },
  });
}

export function useReorderChildren() {
  const client = useQueryClient();

  return useMutation({
    /**
     * Optimistic, because a dragged row that springs back to where it was
     * while the request is in flight reads as a failed drag.
     */
    onMutate: async (variables: ReorderChildrenVariables) => {
      const key = queryKeys.task(variables.id);
      await client.cancelQueries({ queryKey: key });

      const previous = client.getQueryData<WithETag<TaskDocument>>(key);
      if (previous === undefined) return { previous: undefined };

      const root = reorderChildren(
        previous.data.root,
        previous.data.root.id,
        variables.movedId,
        variables.toIndex,
        createContext(PREDICTION_ACTOR),
      );
      client.setQueryData(key, { data: { ...previous.data, root }, etag: previous.etag });

      return { previous };
    },

    onError: (_error, variables, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.task(variables.id), context.previous);
      }
    },

    mutationFn: ({ id, etag, movedId, toIndex }: ReorderChildrenVariables) =>
      api.reorderChildren(id, { movedId, toIndex }, etag),

    onSuccess: (saved) => {
      cacheTask(client, saved);
      invalidateTaskLists(client);
    },
  });
}

interface ReorderChildrenVariables {
  id: string;
  etag: string;
  movedId: string;
  toIndex: number;
}

interface ReorderTasksVariables {
  movedId: string;
  /** The task the moved one now sits below. `null` means the top of the list. */
  afterId: string | null;
  etag: string;
}

/**
 * Move a main task in the manual order.
 *
 * Every cached list is updated, not just the one being looked at: the same task
 * appears in "Alla uppgifter", in its own list, and under whatever filter is
 * active, and leaving the others stale means the row jumps back the moment the
 * user switches view.
 */
export function useReorderTasks() {
  const client = useQueryClient();

  return useMutation({
    onMutate: async (variables: ReorderTasksVariables) => {
      await client.cancelQueries({ queryKey: ['tasks'] });

      const previous = client.getQueriesData<TaskSummary[]>({ queryKey: ['tasks'] });
      for (const [key, summaries] of previous) {
        if (summaries === undefined) continue;
        const moved = moveSummary(summaries, variables.movedId, variables.afterId);
        if (moved !== null) client.setQueryData(key, moved);
      }

      return { previous };
    },

    onError: (_error, _variables, context) => {
      for (const [key, summaries] of context?.previous ?? []) {
        client.setQueryData(key, summaries);
      }
    },

    mutationFn: ({ movedId, afterId, etag }: ReorderTasksVariables) =>
      api.reorderTasks({ movedId, afterId }, etag),

    onSuccess: (saved) => {
      cacheTask(client, saved);
      invalidateTaskLists(client);
    },

    onSettled: () => {
      // The server owns the sparse-float values, and a move can renumber other
      // tasks; the local splice is only ever a stand-in for the real answer.
      invalidateTaskLists(client);
    },
  });
}

/**
 * Splice one summary into its new position.
 *
 * Returns null when the move cannot be represented in this particular cached
 * list — the moved task or its anchor is filtered out of it — so the caller
 * leaves that list alone rather than inventing a position for it.
 */
function moveSummary(
  summaries: readonly TaskSummary[],
  movedId: string,
  afterId: string | null,
): TaskSummary[] | null {
  const from = summaries.findIndex((summary) => summary.id === movedId);
  if (from === -1) return null;

  const without = [...summaries.slice(0, from), ...summaries.slice(from + 1)];

  let to: number;
  if (afterId === null) {
    to = 0;
  } else {
    const anchor = without.findIndex((summary) => summary.id === afterId);
    if (anchor === -1) return null;
    to = anchor + 1;
  }

  return [...without.slice(0, to), summaries[from] as TaskSummary, ...without.slice(to)];
}

/* -------------------------------------------------------------------------- */
/* Optimistic prediction                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Apply a patch locally, using the domain rules rather than guessing.
 *
 * Returns null when the prediction cannot be made safely — an unknown node, or
 * a percent change on a checkbox node — in which case the UI simply waits for
 * the server instead of showing something it is not sure about.
 */
function predictPatch(
  document: TaskDocument,
  nodeId: string,
  patch: PatchNode,
): TaskDocument | null {
  const context = createContext(PREDICTION_ACTOR);

  try {
    const root = updateNode(
      document.root,
      nodeId,
      (node) => {
        let next = node;
        if (patch.title !== undefined) next = { ...next, title: patch.title };
        if (patch.date !== undefined) next = { ...next, date: patch.date };
        if (patch.comments !== undefined) next = { ...next, comments: patch.comments };
        if (patch.percent !== undefined) next = setPercent(next, patch.percent, context);
        if (patch.percentSource === 'derived') next = setPercentToAuto(next, context);
        if (patch.isComplete !== undefined) next = setComplete(next, patch.isComplete, context);
        if (patch.completedDate !== undefined) {
          next = setCompletedDate(next, patch.completedDate, context);
        }
        return next;
      },
      context,
    );
    return { ...document, root };
  } catch {
    return null;
  }
}

/**
 * The prediction's audit stamp is discarded when the real response lands, so it
 * never reaches storage. Naming it makes that obvious if it ever shows up.
 */
const PREDICTION_ACTOR = 'optimistic-prediction';

/* -------------------------------------------------------------------------- */
/* The patch mutation, with conflict handling                                  */
/* -------------------------------------------------------------------------- */

export interface PatchVariables {
  taskId: string;
  /** Omit to patch the main task; supply to patch a subtask. */
  childId?: string;
  patch: PatchNode;
  etag: string;
}

/**
 * Patch a node, handling the 409 case per §7.
 *
 * On conflict: refetch, and if the other person's change did not touch the same
 * fields, replay once against the fresh ETag. Otherwise surface a conflict for
 * the banner to explain — with the user's attempted change preserved.
 *
 * The retry is deliberately capped at one. A loop would be a livelock under
 * sustained concurrent editing, and at that point the user should see what is
 * happening rather than watch a spinner.
 */
export function usePatchNode() {
  const client = useQueryClient();
  const [conflict, setConflict] = useState<PendingConflict | null>(null);

  const mutation = useMutation({
    /**
     * Optimistic update, so a completion tick feels instant.
     *
     * The local prediction is computed with the *same domain functions the
     * server uses*, which is the payoff for putting them in /shared: the
     * checkbox and the derived percent move together, exactly as they will
     * once the write lands, so there is no visible correction afterwards.
     */
    onMutate: async (variables: PatchVariables) => {
      const key = queryKeys.task(variables.taskId);
      await client.cancelQueries({ queryKey: key });

      const previous = client.getQueryData<WithETag<TaskDocument>>(key);
      if (previous === undefined) return { previous: undefined };

      const nodeId = variables.childId ?? previous.data.root.id;
      const predicted = predictPatch(previous.data, nodeId, variables.patch);
      if (predicted !== null) {
        client.setQueryData(key, { data: predicted, etag: previous.etag });
      }

      return { previous };
    },

    onError: (_error, variables, context) => {
      // Put the old value back. The conflict path refetches anyway, but a
      // network failure must not leave a phantom tick on screen.
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.task(variables.taskId), context.previous);
      }
    },

    mutationFn: async (variables: PatchVariables): Promise<WithETag<TaskDocument>> => {
      const send = (etag: string) =>
        variables.childId === undefined
          ? api.patchTask(variables.taskId, { node: variables.patch }, etag)
          : api.patchChild(variables.taskId, variables.childId, variables.patch, etag);

      try {
        return await send(variables.etag);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.isConflict) throw error;

        // Someone got there first. Find out what they changed.
        const base = client.getQueryData<WithETag<TaskDocument>>(
          queryKeys.task(variables.taskId),
        )?.data;
        const latest = await api.getTask(variables.taskId);

        const nodeId = variables.childId ?? latest.data.root.id;
        const analysis = analyseConflict(base, latest.data, nodeId, variables.patch);

        cacheTask(client, latest);

        if (analysis.canRetry) {
          // Disjoint edits: replay against the newer version. The user never
          // needed to know this happened.
          return await send(latest.etag);
        }

        setConflict({
          taskId: variables.taskId,
          nodeId,
          collidingFields: analysis.collidingFields,
          attemptedPatch: variables.patch,
          latest: latest.data,
          latestETag: latest.etag,
        });

        throw error;
      }
    },

    onSuccess: (saved) => {
      cacheTask(client, saved);
      invalidateTaskLists(client);
      setConflict(null);
    },
  });

  const dismissConflict = useCallback(() => setConflict(null), []);

  /** Apply the user's preserved edit on top of the other person's version. */
  const forceConflictResolution = useCallback(() => {
    if (conflict === null) return;
    const variables: PatchVariables = {
      taskId: conflict.taskId,
      patch: conflict.attemptedPatch,
      etag: conflict.latestETag,
      ...(conflict.nodeId !== conflict.latest.root.id ? { childId: conflict.nodeId } : {}),
    };
    setConflict(null);
    mutation.mutate(variables);
  }, [conflict, mutation]);

  return { ...mutation, conflict, dismissConflict, forceConflictResolution };
}

/* -------------------------------------------------------------------------- */
/* List mutations                                                              */
/* -------------------------------------------------------------------------- */

function cacheLists(client: QueryClient, lists: TaskList[], etag: string): void {
  client.setQueryData(queryKeys.lists, { data: lists, etag });
}

export function useCreateList() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, etag }: { name: string; etag: string | null }) => {
      const saved = await api.createList({ name }, etag);
      return saved;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.lists });
    },
  });
}

export function useRenameList() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name, etag }: { id: string; name: string; etag: string }) =>
      api.patchList(id, { name }, etag),
    onSuccess: (saved) => {
      cacheLists(client, saved.data.lists, saved.etag);
    },
  });
}

interface SetListColorVariables {
  id: string;
  /** A token name from `listColors.ts`, or null for no colour. */
  colorToken: string | null;
  etag: string;
}

export function useSetListColor() {
  const client = useQueryClient();

  return useMutation({
    /**
     * Optimistic: a colour is a glance-level change, and waiting for a round
     * trip to see it makes picking one feel broken.
     */
    onMutate: async ({ id, colorToken }: SetListColorVariables) => {
      await client.cancelQueries({ queryKey: queryKeys.lists });

      const previous = client.getQueryData<WithETag<TaskList[]>>(queryKeys.lists);
      if (previous === undefined) return { previous: undefined };

      cacheLists(
        client,
        previous.data.map((list) => (list.id === id ? { ...list, colorToken } : list)),
        previous.etag,
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        cacheLists(client, context.previous.data, context.previous.etag);
      }
    },

    mutationFn: ({ id, colorToken, etag }: SetListColorVariables) =>
      api.patchList(id, { colorToken }, etag),

    onSuccess: (saved) => {
      cacheLists(client, saved.data.lists, saved.etag);
    },
  });
}

export function useDeleteList() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, etag }: { id: string; etag: string }) => api.deleteList(id, etag),
    onSuccess: (saved) => {
      cacheLists(client, saved.data.lists, saved.etag);
      invalidateTaskLists(client);
    },
  });
}

interface ReorderListsVariables {
  movedId: string;
  toIndex: number;
  etag: string;
}

export function useReorderLists() {
  const client = useQueryClient();

  return useMutation({
    /**
     * Optimistic, like the task drags: a list that springs back to where it was
     * while the write is in flight reads as a drag that failed.
     *
     * Only the array is spliced, not the `order` values — the server owns those,
     * and the response replaces this whole cache entry anyway.
     */
    onMutate: async (variables: ReorderListsVariables) => {
      await client.cancelQueries({ queryKey: queryKeys.lists });

      const previous = client.getQueryData<WithETag<TaskList[]>>(queryKeys.lists);
      if (previous === undefined) return { previous: undefined };

      const from = previous.data.findIndex((list) => list.id === variables.movedId);
      if (from === -1) return { previous };

      const without = [...previous.data.slice(0, from), ...previous.data.slice(from + 1)];
      const to = Math.max(0, Math.min(without.length, variables.toIndex));
      const moved = previous.data[from] as TaskList;

      cacheLists(
        client,
        [...without.slice(0, to), moved, ...without.slice(to)],
        // The ETag stays put: the optimistic order is a local guess, and the
        // token still belongs to the version the server holds.
        previous.etag,
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        cacheLists(client, context.previous.data, context.previous.etag);
      }
    },

    mutationFn: ({ movedId, toIndex, etag }: ReorderListsVariables) =>
      api.reorderLists({ movedId, toIndex }, etag),

    onSuccess: (saved) => {
      cacheLists(client, saved.data.lists, saved.etag);
    },
  });
}
