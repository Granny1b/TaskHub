import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  countChildren,
  createCompletion,
  derivePercent,
  getPercent,
  isPercentDerived,
  isTaskComplete,
  openChildCount,
  recomputeDerivedPercent,
  setComplete,
  setCompletedDate,
  setPercent,
  setPercentToAuto,
} from './completion.js';
import { DomainError } from './errors.js';
import { ctx, mainTask, subtask, taskWithChildren } from './__testing__/fixtures.js';

/**
 * These tests are the specification of §4 made executable. The four invariants
 * the build order names by hand each get their own block below, because they
 * are the ones most likely to be quietly broken by a later "simplification".
 */

describe('isTaskComplete — the sole authority on done', () => {
  it('reads the checkbox for percent-kind nodes, not the percent', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 100, isComplete: false, percentSource: 'manual' },
    });
    expect(isTaskComplete(task)).toBe(false);
  });

  it('reads the checkbox for checkbox-kind nodes', () => {
    expect(isTaskComplete(subtask({ completion: { kind: 'checkbox', isComplete: true } }))).toBe(
      true,
    );
  });

  it('reports a task complete at a low percent when the override is ticked', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 40, isComplete: true, percentSource: 'manual' },
    });
    expect(isTaskComplete(task)).toBe(true);
    expect(getPercent(task)).toBe(40);
  });
});

describe('INVARIANT: the override preserves the stored percent across tick and untick', () => {
  it('keeps 40% when ticked, and still has 40% when unticked', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 40, isComplete: false, percentSource: 'manual' },
    });

    const ticked = setComplete(task, true, ctx());
    expect(isTaskComplete(ticked)).toBe(true);
    expect(getPercent(ticked)).toBe(40);

    const unticked = setComplete(ticked, false, ctx());
    expect(isTaskComplete(unticked)).toBe(false);
    expect(getPercent(unticked)).toBe(40);
  });

  it('never rewrites the percent to 100 on completion', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 0, isComplete: false, percentSource: 'manual' },
    });
    expect(getPercent(setComplete(task, true, ctx()))).toBe(0);
  });

  it('preserves percentSource across the toggle', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 60, isComplete: false, percentSource: 'derived' },
    });
    const ticked = setComplete(task, true, ctx());
    expect(isPercentDerived(ticked)).toBe(true);
  });
});

describe('INVARIANT: reaching 100 percent does not auto-tick the checkbox', () => {
  it('leaves isComplete false when the percent is set to 100 by hand', () => {
    const task = mainTask();
    const updated = setPercent(task, 100, ctx());
    expect(getPercent(updated)).toBe(100);
    expect(isTaskComplete(updated)).toBe(false);
  });

  it('leaves isComplete false when every subtask is done and percent derives to 100', () => {
    const task = recomputeDerivedPercent(taskWithChildren(3, 3), ctx());
    expect(getPercent(task)).toBe(100);
    expect(isTaskComplete(task)).toBe(false);
  });

  it('does not stamp a completedDate when percent reaches 100', () => {
    const updated = setPercent(mainTask(), 100, ctx());
    expect(updated.completedDate).toBeNull();
  });
});

describe('INVARIANT: derived to manual is one-way until explicitly reset', () => {
  it('flips to manual when the percent is edited by hand', () => {
    const task = recomputeDerivedPercent(taskWithChildren(4, 1), ctx());
    expect(isPercentDerived(task)).toBe(true);

    const edited = setPercent(task, 90, ctx());
    expect(isPercentDerived(edited)).toBe(false);
    expect(getPercent(edited)).toBe(90);
  });

  it('stays manual when a subtask is later completed', () => {
    const manual = setPercent(taskWithChildren(4, 1), 90, ctx());
    const children = manual.children.map((child, index) =>
      index === 1
        ? { ...child, completion: { kind: 'checkbox' as const, isComplete: true } }
        : child,
    );

    const after = recomputeDerivedPercent({ ...manual, children }, ctx());
    expect(getPercent(after)).toBe(90);
    expect(isPercentDerived(after)).toBe(false);
  });

  it('stays manual when a subtask is added — no surprise reversals', () => {
    const manual = setPercent(taskWithChildren(2, 0), 25, ctx());
    const withExtra = recomputeDerivedPercent(
      { ...manual, children: [...manual.children, subtask({ title: 'Ny' })] },
      ctx(),
    );
    expect(getPercent(withExtra)).toBe(25);
    expect(isPercentDerived(withExtra)).toBe(false);
  });

  it('returns to derived only through the explicit back-to-auto affordance', () => {
    const manual = setPercent(taskWithChildren(4, 2), 90, ctx());
    const auto = setPercentToAuto(manual, ctx());
    expect(isPercentDerived(auto)).toBe(true);
    expect(getPercent(auto)).toBe(50);
  });
});

describe('INVARIANT: completing a parent leaves child state untouched', () => {
  it('does not cascade completion to subtasks', () => {
    const task = taskWithChildren(3, 1);
    const completed = setComplete(task, true, ctx());

    expect(isTaskComplete(completed)).toBe(true);
    expect(completed.children.map(isTaskComplete)).toEqual([true, false, false]);
  });

  it('keeps the real child ratio visible after the parent is completed', () => {
    const completed = setComplete(taskWithChildren(7, 4), true, ctx());
    expect(countChildren(completed)).toEqual({ total: 7, done: 4 });
    expect(openChildCount(completed)).toBe(3);
  });
});

describe('completedDate (Färdig datum)', () => {
  it('stamps today when completion flips from false to true', () => {
    const completed = setComplete(mainTask(), true, ctx({ today: '2026-08-11' }));
    expect(completed.completedDate).toBe('2026-08-11');
  });

  it('clears when completion flips from true to false', () => {
    const completed = setComplete(mainTask(), true, ctx());
    expect(setComplete(completed, false, ctx()).completedDate).toBeNull();
  });

  it('does not overwrite a manually corrected date on a repeat toggle', () => {
    const completed = setComplete(mainTask(), true, ctx());
    const corrected = setCompletedDate(completed, '2026-07-01', ctx());

    // Re-asserting the same state must not re-stamp.
    const again = setComplete(corrected, true, ctx({ today: '2026-08-11' }));
    expect(again.completedDate).toBe('2026-07-01');
  });

  it('leaves the date alone when the completion value has not changed', () => {
    const open = mainTask({ completedDate: '2026-01-01' });
    expect(setComplete(open, false, ctx()).completedDate).toBe('2026-01-01');
  });

  it('applies the same invariant to checkbox subtasks', () => {
    const done = setComplete(subtask(), true, ctx({ today: '2026-08-11' }));
    expect(done.completedDate).toBe('2026-08-11');
    expect(setComplete(done, false, ctx()).completedDate).toBeNull();
  });
});

describe('derived percent', () => {
  it('mirrors the subtask ratio, rounded', () => {
    expect(getPercent(recomputeDerivedPercent(taskWithChildren(7, 4), ctx()))).toBe(57);
    expect(getPercent(recomputeDerivedPercent(taskWithChildren(3, 1), ctx()))).toBe(33);
    expect(getPercent(recomputeDerivedPercent(taskWithChildren(4, 2), ctx()))).toBe(50);
  });

  it('falls back to manual and keeps the last value when the final subtask is removed', () => {
    const derived = recomputeDerivedPercent(taskWithChildren(2, 1), ctx());
    expect(getPercent(derived)).toBe(50);

    const emptied = recomputeDerivedPercent({ ...derived, children: [] }, ctx());
    expect(isPercentDerived(emptied)).toBe(false);
    expect(getPercent(emptied)).toBe(50);
  });

  it('is a no-op on checkbox nodes', () => {
    const child = subtask();
    expect(recomputeDerivedPercent(child, ctx())).toBe(child);
  });

  it('returns the same object when nothing changed, so React can skip it', () => {
    const task = recomputeDerivedPercent(taskWithChildren(2, 1), ctx());
    expect(recomputeDerivedPercent(task, ctx())).toBe(task);
  });
});

describe('guards', () => {
  it('refuses to set a percent on a checkbox node', () => {
    expect(() => setPercent(subtask(), 50, ctx())).toThrow(DomainError);
  });

  it('refuses to set a percent source on a checkbox node', () => {
    expect(() => setPercentToAuto(subtask(), ctx())).toThrow(DomainError);
  });

  it('clamps out-of-range percents rather than storing them', () => {
    expect(getPercent(setPercent(mainTask(), 150, ctx()))).toBe(100);
    expect(getPercent(setPercent(mainTask(), -20, ctx()))).toBe(0);
    expect(getPercent(setPercent(mainTask(), 33.6, ctx()))).toBe(34);
  });

  it('clamps non-finite input to the minimum', () => {
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('helpers', () => {
  it('derivePercent handles the zero-children case without dividing by zero', () => {
    expect(derivePercent(0, 0)).toBe(0);
  });

  it('getPercent is null for checkbox nodes', () => {
    expect(getPercent(subtask())).toBeNull();
  });

  it('createCompletion starts percent nodes derived so subtasks drive the bar', () => {
    const completion = createCompletion('percent');
    expect(completion).toEqual({
      kind: 'percent',
      percent: 0,
      isComplete: false,
      percentSource: 'derived',
    });
  });

  it('createCompletion starts checkbox nodes open', () => {
    expect(createCompletion('checkbox')).toEqual({ kind: 'checkbox', isComplete: false });
  });

  it('records who changed a node and when', () => {
    const updated = setComplete(
      mainTask(),
      true,
      ctx({ actor: 'anna', now: '2026-08-11T10:00:00.000Z' }),
    );
    expect(updated.updatedBy).toBe('anna');
    expect(updated.updatedAt).toBe('2026-08-11T10:00:00.000Z');
  });
});
