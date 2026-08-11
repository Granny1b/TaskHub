import { describe, expect, it } from 'vitest';
import {
  MIN_ORDER_GAP,
  ORDER_STEP,
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
