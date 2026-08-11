/**
 * Sparse-float ordering (§8).
 *
 * Reordering a sibling writes one number instead of renumbering the whole list,
 * which matters because siblings live inside a single blob under one ETag —
 * every extra field touched is another chance for a concurrent edit to collide.
 *
 * Floats run out of usable precision after enough insertions between the same
 * two neighbours, so when the gap closes below `MIN_ORDER_GAP` the sibling list
 * is renormalised back to whole thousands.
 *
 * All of it is pure and lives here. Ordering maths must never appear in a
 * component or a handler.
 */

/** New items are appended at `lastOrder + ORDER_STEP`. */
export const ORDER_STEP = 1000;

/** Below this gap between neighbours, renormalise instead of subdividing. */
export const MIN_ORDER_GAP = 0.001;

export interface Ordered {
  readonly order: number;
}

/** Ascending by `order`. Stable, and never mutates the input. */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** The order value for a new item appended to the end of `siblings`. */
export function nextOrder(siblings: readonly Ordered[]): number {
  if (siblings.length === 0) return ORDER_STEP;
  let max = Number.NEGATIVE_INFINITY;
  for (const sibling of siblings) {
    if (sibling.order > max) max = sibling.order;
  }
  return max + ORDER_STEP;
}

/**
 * A value strictly between two neighbours.
 *
 * `null` means "no neighbour on that side": moving to the head or the tail.
 * Returns `null` when the neighbours are too close to subdivide safely — the
 * caller's cue to renormalise.
 */
export function orderBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return ORDER_STEP;
  if (before === null && after !== null) return after - ORDER_STEP;
  if (before !== null && after === null) return before + ORDER_STEP;

  const low = before as number;
  const high = after as number;
  if (high - low < MIN_ORDER_GAP) return null;
  return low + (high - low) / 2;
}

/** Whole thousands: 1000, 2000, 3000… */
export function renormalisedOrders(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * ORDER_STEP);
}

/** True when any adjacent pair has closed to within `MIN_ORDER_GAP`. */
export function needsRenormalisation(siblings: readonly Ordered[]): boolean {
  const sorted = sortByOrder(siblings);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    if (current.order - previous.order < MIN_ORDER_GAP) return true;
  }
  return false;
}

export interface ReorderResult<T extends Ordered> {
  /** The siblings in their new order, with `order` values rewritten. */
  readonly items: T[];
  /** True when the whole sibling list was renumbered rather than one item moved. */
  readonly renormalised: boolean;
}

/**
 * Move one sibling to `toIndex` within its list.
 *
 * Normally rewrites exactly one `order` value. If the neighbours at the target
 * position are too close to fit a value between them, the entire sibling list
 * is renormalised to whole thousands and every item is rewritten — rare, and
 * the alternative is silently losing ordering to float precision.
 */
export function reorderSiblings<T extends Ordered & { id: string }>(
  siblings: readonly T[],
  movedId: string,
  toIndex: number,
): ReorderResult<T> {
  const sorted = sortByOrder(siblings);
  const fromIndex = sorted.findIndex((item) => item.id === movedId);
  if (fromIndex === -1) {
    return { items: sorted, renormalised: false };
  }

  const moved = sorted[fromIndex] as T;
  const without = [...sorted.slice(0, fromIndex), ...sorted.slice(fromIndex + 1)];
  const target = Math.max(0, Math.min(without.length, toIndex));

  const before = target > 0 ? (without[target - 1]?.order ?? null) : null;
  const after = target < without.length ? (without[target]?.order ?? null) : null;

  const candidate = orderBetween(before, after);

  if (candidate !== null) {
    const items = [
      ...without.slice(0, target),
      { ...moved, order: candidate },
      ...without.slice(target),
    ];
    return { items, renormalised: false };
  }

  // Gap exhausted — renumber the whole sibling list. See the MIN_ORDER_GAP note.
  const arranged = [...without.slice(0, target), moved, ...without.slice(target)];
  const orders = renormalisedOrders(arranged.length);
  const items = arranged.map((item, index) => ({ ...item, order: orders[index] as number }));
  return { items, renormalised: true };
}

/** Force a renumber of a sibling list, preserving current relative order. */
export function renormalise<T extends Ordered>(siblings: readonly T[]): T[] {
  const sorted = sortByOrder(siblings);
  const orders = renormalisedOrders(sorted.length);
  return sorted.map((item, index) => ({ ...item, order: orders[index] as number }));
}
