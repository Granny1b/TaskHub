import { describe, expect, it } from 'vitest';
import {
  MIN_ORDER_GAP,
  ORDER_STEP,
  compareByOrderThenId,
  indexAfter,
  needsRenormalisation,
  nextOrder,
  orderBetween,
  renormalise,
  renormalisedOrders,
  reorderSiblings,
  sortByOrder,
} from './ordering.js';

interface Item {
  id: string;
  order: number;
}

const items = (...orders: number[]): Item[] =>
  orders.map((order, index) => ({ id: `item-${index}`, order }));

describe('nextOrder', () => {
  it('starts at one step for an empty list', () => {
    expect(nextOrder([])).toBe(ORDER_STEP);
  });

  it('appends one step past the highest existing order', () => {
    expect(nextOrder(items(1000, 2000, 3000))).toBe(4000);
  });

  it('uses the maximum rather than the last array element', () => {
    expect(nextOrder(items(3000, 1000, 2000))).toBe(4000);
  });
});

describe('orderBetween', () => {
  it('returns the midpoint between two neighbours', () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
  });

  it('steps below the first item when moving to the head', () => {
    expect(orderBetween(null, 1000)).toBe(0);
  });

  it('steps past the last item when moving to the tail', () => {
    expect(orderBetween(3000, null)).toBe(4000);
  });

  it('returns a first value for an empty list', () => {
    expect(orderBetween(null, null)).toBe(ORDER_STEP);
  });

  it('signals exhaustion when the neighbours are too close to subdivide', () => {
    expect(orderBetween(1000, 1000 + MIN_ORDER_GAP / 2)).toBeNull();
  });
});

describe('sortByOrder', () => {
  it('sorts ascending without mutating the input', () => {
    const input = items(3000, 1000, 2000);
    const sorted = sortByOrder(input);
    expect(sorted.map((item) => item.order)).toEqual([1000, 2000, 3000]);
    expect(input.map((item) => item.order)).toEqual([3000, 1000, 2000]);
  });
});

describe('reorderSiblings', () => {
  it('moves an item to the head', () => {
    const result = reorderSiblings(items(1000, 2000, 3000), 'item-2', 0);
    expect(result.items.map((item) => item.id)).toEqual(['item-2', 'item-0', 'item-1']);
    expect(result.renormalised).toBe(false);
  });

  it('moves an item to the tail', () => {
    const result = reorderSiblings(items(1000, 2000, 3000), 'item-0', 2);
    expect(result.items.map((item) => item.id)).toEqual(['item-1', 'item-2', 'item-0']);
  });

  it('moves an item into the middle', () => {
    const result = reorderSiblings(items(1000, 2000, 3000), 'item-0', 1);
    expect(result.items.map((item) => item.id)).toEqual(['item-1', 'item-0', 'item-2']);
  });

  it('rewrites exactly one order value in the normal case', () => {
    const original = items(1000, 2000, 3000);
    const result = reorderSiblings(original, 'item-0', 1);
    const changed = result.items.filter((item) => {
      const before = original.find((candidate) => candidate.id === item.id);
      return before === undefined || before.order !== item.order;
    });
    expect(changed).toHaveLength(1);
  });

  it('leaves the list untouched when the id is not a sibling', () => {
    const result = reorderSiblings(items(1000, 2000), 'nope', 0);
    expect(result.items.map((item) => item.id)).toEqual(['item-0', 'item-1']);
    expect(result.renormalised).toBe(false);
  });

  it('clamps an out-of-range target index', () => {
    const result = reorderSiblings(items(1000, 2000, 3000), 'item-0', 99);
    expect(result.items[result.items.length - 1]?.id).toBe('item-0');
  });

  it('renormalises when the gap between neighbours is exhausted', () => {
    const tight = [
      { id: 'a', order: 1000 },
      { id: 'b', order: 1000 + MIN_ORDER_GAP / 4 },
      { id: 'c', order: 3000 },
    ];
    const result = reorderSiblings(tight, 'c', 1);

    expect(result.renormalised).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(result.items.map((item) => item.order)).toEqual([1000, 2000, 3000]);
  });

  it('keeps ordering stable through repeated head insertions', () => {
    let list: Item[] = items(1000);
    for (let index = 1; index <= 30; index += 1) {
      list = [...list, { id: `new-${index}`, order: 9_000_000 }];
      list = reorderSiblings(list, `new-${index}`, 0).items;
    }
    const orders = list.map((item) => item.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(list[0]?.id).toBe('new-30');
  });
});

describe('renormalisation', () => {
  it('produces whole thousands', () => {
    expect(renormalisedOrders(3)).toEqual([1000, 2000, 3000]);
    expect(renormalisedOrders(0)).toEqual([]);
  });

  it('detects an exhausted gap', () => {
    expect(needsRenormalisation(items(1000, 2000))).toBe(false);
    expect(needsRenormalisation(items(1000, 1000 + MIN_ORDER_GAP / 2))).toBe(true);
    expect(needsRenormalisation(items(1000))).toBe(false);
  });

  it('renumbers while preserving relative order', () => {
    const renumbered = renormalise(items(5, 1.5, 900));
    expect(renumbered.map((item) => item.id)).toEqual(['item-1', 'item-0', 'item-2']);
    expect(renumbered.map((item) => item.order)).toEqual([1000, 2000, 3000]);
  });
});

describe('compareByOrderThenId', () => {
  const task = (id: string, order: number) => ({ id, order });

  it('sorts by order', () => {
    const sorted = [task('b', 2000), task('a', 1000)].sort(compareByOrderThenId);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('breaks a tie by id, so a list of never-reordered tasks keeps creation order', () => {
    // Every task written before manual ordering existed carries ORDER_STEP.
    // ULIDs sort by creation time, so the tie-break is the order they were
    // raised in — which is what the list showed before ordering existed.
    const sorted = [
      task('01JB000000000000000000000Z', ORDER_STEP),
      task('01JA000000000000000000000Z', ORDER_STEP),
    ].sort(compareByOrderThenId);
    expect(sorted[0]?.id.startsWith('01JA')).toBe(true);
  });
});

describe('indexAfter', () => {
  const list = [
    { id: 'a', order: 1000 },
    { id: 'b', order: 2000 },
    { id: 'c', order: 3000 },
  ];

  it('null anchors to the head', () => {
    expect(indexAfter(list, 'c', null)).toBe(0);
  });

  it('places an item straight after its anchor', () => {
    // 'a' removed leaves [b, c]; after 'b' is index 1.
    expect(indexAfter(list, 'a', 'b')).toBe(1);
    expect(indexAfter(list, 'a', 'c')).toBe(2);
  });

  it('produces an index that round-trips through reorderSiblings', () => {
    const index = indexAfter(list, 'a', 'b');
    const { items } = reorderSiblings(list, 'a', index);
    expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('appends when the anchor has gone', () => {
    // A stale client dropped onto a task someone else has since deleted.
    // Appending moves nothing else, which beats guessing.
    expect(indexAfter(list, 'a', 'deleted')).toBe(2);
  });

  it('is unaffected by the input being unsorted', () => {
    const shuffled = [list[2], list[0], list[1]] as typeof list;
    expect(indexAfter(shuffled, 'a', 'b')).toBe(1);
  });
});
