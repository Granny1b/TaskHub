/**
 * What a draggable carries with it, for every draggable in the app.
 *
 * This lives in `lib` rather than beside any one feature because the drag
 * surface spans the whole shell: a task row is picked up in the list and can be
 * dropped on a list in the side panel. One `DndContext` covers both, so one
 * vocabulary has to as well.
 *
 * `type` is what the drop handler routes on, and what stops a subtask being
 * dropped into the main list: dnd-kit reports the nearest droppable whatever it
 * is, so the meaning of a drop is decided here rather than by geometry.
 */
export type DragItemData =
  /** A main task row. Carries the ETag current when it was picked up. */
  | { type: 'task'; etag: string }
  /**
   * A subtask. Carries its parent and its siblings, because the index the
   * server wants is an index among siblings, not among the rows on screen.
   */
  | { type: 'child'; taskId: string; siblingIds: string[]; etag: string }
  /**
   * A list in the side panel — both a draggable (reorder) and a drop target
   * (move a task into it). `listId` is null for the "ungrouped" row, which is
   * a drop target only: dropping a task there takes it out of every list.
   */
  | { type: 'list'; listId: string | null };

export function dragDataOf(data: unknown): DragItemData | undefined {
  return (data ?? undefined) as DragItemData | undefined;
}
