import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { TaskFilter } from '../../lib/apiClient.js';
import { dragDataOf, type DragItemData } from '../../lib/dragTypes.js';
import {
  useLists,
  useMoveTaskToList,
  useReorderChildren,
  useReorderLists,
  useReorderTasks,
  useTasks,
} from '../../lib/queries.js';

interface DragSurfaceProps {
  /** The filter the task list is showing, so this reads the same cached rows. */
  filter: TaskFilter;
  children: React.ReactNode;
}

/**
 * Everything draggable in the app, under one context.
 *
 * It has to be one. A task row is picked up in the list and can be dropped on a
 * list in the side panel — two different regions of the tree — and dnd-kit
 * cannot drag between separate `DndContext`s. So the context lives above both,
 * and this module owns what a drop *means*:
 *
 *   task  → task   reorder the main list
 *   task  → list   move the task into that list (or out of all of them)
 *   child → child  reorder subtasks within their parent
 *   list  → list   reorder the side panel
 *
 * Anything else is refused. The regions below keep their own `SortableContext`
 * and their own rendering; only the arbitration is here.
 *
 * Reading `useTasks(filter)` and `useLists()` here costs no extra request —
 * TanStack Query hands back the same cached arrays the panel and list are
 * already rendering.
 */
export function DragSurface({ filter, children }: DragSurfaceProps) {
  const { t } = useTranslation();
  const tasks = useTasks(filter);
  const lists = useLists();

  const reorderTasks = useReorderTasks();
  const reorderChildren = useReorderChildren();
  const reorderLists = useReorderLists();
  const moveTask = useMoveTaskToList();

  const [activeType, setActiveType] = useState<DragItemData['type'] | null>(null);

  const summaries = useMemo(() => tasks.data ?? [], [tasks.data]);
  const listItems = useMemo(() => lists.data?.data ?? [], [lists.data]);
  const listEtag = lists.data?.etag ?? '';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /*
    Pointer first, geometry second.

    `closestCenter` alone compares the dragged row's centre to every droppable,
    and a task row dragged onto the side panel is still, by centre, closest to
    the row it came from — so the panel never wins and the drop is impossible.
    `pointerWithin` asks the question the user is actually answering: what is
    under my cursor? It returns nothing for a keyboard drag, which is what the
    fallback is for.
  */
  const collisionDetection: CollisionDetection = (args) => {
    const underPointer = pointerWithin(args);
    return underPointer.length > 0 ? underPointer : closestCenter(args);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveType(null);

    const { active, over } = event;
    if (over === null || active.id === over.id) return;

    const activeData = dragDataOf(active.data.current);
    const overData = dragDataOf(over.data.current);
    if (activeData === undefined || overData === undefined) return;

    const movedId = String(active.id);
    const overId = String(over.id);

    // A task dropped on a list in the panel — the cross-region case this whole
    // arrangement exists for.
    if (activeData.type === 'task' && overData.type === 'list') {
      moveTask.mutate({ id: movedId, listId: overData.listId, etag: activeData.etag });
      return;
    }

    if (activeData.type === 'task' && overData.type === 'task') {
      const ids = summaries.map((summary) => summary.id);
      const from = ids.indexOf(movedId);
      const to = ids.indexOf(overId);
      if (from === -1 || to === -1) return;

      // The anchor is read from the list as it will look after the move, so it
      // means the same thing to the server as it does on screen.
      const reordered = arrayMove(ids, from, to);
      const position = reordered.indexOf(movedId);
      reorderTasks.mutate({
        movedId,
        afterId: position === 0 ? null : (reordered[position - 1] ?? null),
        etag: activeData.etag,
      });
      return;
    }

    if (activeData.type === 'child' && overData.type === 'child') {
      const toIndex = activeData.siblingIds.indexOf(overId);
      if (toIndex === -1) return;
      reorderChildren.mutate({
        id: activeData.taskId,
        movedId,
        toIndex,
        etag: activeData.etag,
      });
      return;
    }

    if (activeData.type === 'list' && overData.type === 'list') {
      // The ungrouped row is a drop target, never a position to reorder into.
      if (overData.listId === null) return;
      const toIndex = listItems.findIndex((list) => list.id === overId);
      if (toIndex === -1) return;
      reorderLists.mutate({ movedId, toIndex, etag: listEtag });
    }
  };

  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number): string => {
      const key = String(id);
      return (
        summaries.find((summary) => summary.id === key)?.title ??
        listItems.find((list) => list.id === key)?.name ??
        key
      );
    };

    return {
      onDragStart: ({ active }) => t('dnd.picked', { name: nameOf(active.id) }),
      onDragOver: ({ active, over }) => {
        if (over === null || over.id === active.id) return undefined;
        const overData = dragDataOf(over.data.current);
        const activeData = dragDataOf(active.data.current);
        // "Moving to Maskin 7" and "moving into Maskin 7" are different
        // outcomes, and the person who cannot see the screen needs the
        // difference before they let go.
        if (activeData?.type === 'task' && overData?.type === 'list') {
          return t('dnd.intoList', {
            name: overData.listId === null ? t('lists.ungrouped') : nameOf(over.id),
          });
        }
        return t('dnd.over', { name: nameOf(over.id) });
      },
      onDragEnd: ({ active, over }) =>
        over === null
          ? t('dnd.cancelled', { name: nameOf(active.id) })
          : t('dnd.dropped', { name: nameOf(active.id) }),
      onDragCancel: ({ active }) => t('dnd.cancelled', { name: nameOf(active.id) }),
    };
  }, [t, summaries, listItems]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      /*
        A task has to travel sideways to reach the panel, so it moves freely.
        Subtasks and lists only ever reorder within a column, and pinning them
        to the vertical axis keeps that from looking like a drag that missed.
      */
      modifiers={activeType === 'task' ? [] : [restrictToVerticalAxis]}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('dnd.instructions') },
      }}
      onDragStart={(event: DragStartEvent) =>
        setActiveType(dragDataOf(event.active.data.current)?.type ?? null)
      }
      onDragCancel={() => setActiveType(null)}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DndContext>
  );
}
