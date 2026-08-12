// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SWIPE_THRESHOLD, useSwipeToComplete } from './useSwipeToComplete.js';

/**
 * The gesture, driven by synthetic pointer events.
 *
 * What is worth pinning down here is not the arithmetic but the arbitration: a
 * swipe, a scroll and a tap all start with a finger going down on the same
 * pixel, and getting that wrong makes the list feel broken in ways no type
 * checker notices.
 */

interface PointerLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  currentTarget: { setPointerCapture: (id: number) => void };
}

function pointer(x: number, y: number, type = 'touch'): PointerLike {
  return {
    pointerId: 1,
    pointerType: type,
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: () => undefined },
  };
}

/** The hook's handlers take React's synthetic events; these stand in for them. */
type Handlers = ReturnType<typeof useSwipeToComplete>['handlers'];
const down = (h: Handlers, e: PointerLike) =>
  h.onPointerDown(e as unknown as React.PointerEvent<HTMLElement>);
const move = (h: Handlers, e: PointerLike) =>
  h.onPointerMove(e as unknown as React.PointerEvent<HTMLElement>);
const up = (h: Handlers, e: PointerLike) =>
  h.onPointerUp(e as unknown as React.PointerEvent<HTMLElement>);
const cancel = (h: Handlers, e: PointerLike) =>
  h.onPointerCancel(e as unknown as React.PointerEvent<HTMLElement>);

describe('useSwipeToComplete', () => {
  it('commits when the row is dragged past the threshold', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(40, 2));
    });
    expect(result.current.swiping).toBe(true);
    expect(result.current.armed).toBe(false);

    act(() => {
      move(result.current.handlers, pointer(SWIPE_THRESHOLD + 10, 2));
    });
    expect(result.current.armed).toBe(true);

    act(() => {
      up(result.current.handlers, pointer(SWIPE_THRESHOLD + 10, 2));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    // The row springs back either way; the task's own state is what changed.
    expect(result.current.offset).toBe(0);
  });

  it('does nothing when the finger stops short', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(SWIPE_THRESHOLD - 20, 0));
      up(result.current.handlers, pointer(SWIPE_THRESHOLD - 20, 0));
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  it('yields to a vertical drag, so the list still scrolls', () => {
    // The single most important case. A gesture that steals the scroll makes
    // every row feel stuck, and the user never learns why.
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(4, 30));
      // Even a later sideways movement must not resurrect the swipe.
      move(result.current.handlers, pointer(120, 40));
      up(result.current.handlers, pointer(120, 40));
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.swiping).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('treats a diagonal tie as a scroll', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(20, 20));
      up(result.current.handlers, pointer(20, 20));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('refuses to move left', () => {
    // A leftward swipe has no second meaning here, and a row that follows the
    // finger would promise one.
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(-120, 0));
    });

    expect(result.current.offset).toBe(0);

    act(() => {
      up(result.current.handlers, pointer(-120, 0));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resists past the threshold instead of following the finger', () => {
    const { result } = renderHook(() => useSwipeToComplete(vi.fn()));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(400, 0));
    });

    expect(result.current.offset).toBeGreaterThan(SWIPE_THRESHOLD);
    expect(result.current.offset).toBeLessThan(200);
  });

  it('abandons the action when the gesture is cancelled', () => {
    // A phone call, a system gesture, a notification. Whatever interrupted it
    // did not mean "tick this off".
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(SWIPE_THRESHOLD + 30, 0));
      cancel(result.current.handlers, pointer(SWIPE_THRESHOLD + 30, 0));
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  it('ignores a mouse', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit));

    act(() => {
      down(result.current.handlers, pointer(0, 0, 'mouse'));
      move(result.current.handlers, pointer(200, 0, 'mouse'));
      up(result.current.handlers, pointer(200, 0, 'mouse'));
    });

    expect(result.current.offset).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does nothing at all when disabled', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSwipeToComplete(onCommit, false));

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(200, 0));
      up(result.current.handlers, pointer(200, 0));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('swallows the click a swipe would otherwise end with', () => {
    // Without this every swipe also opens the task it just ticked off.
    const { result } = renderHook(() => useSwipeToComplete(vi.fn()));
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    act(() => {
      down(result.current.handlers, pointer(0, 0));
      move(result.current.handlers, pointer(60, 0));
      up(result.current.handlers, pointer(60, 0));
    });

    result.current.suppressClick(click as unknown as React.MouseEvent);
    expect(click.preventDefault).toHaveBeenCalled();

    // And only once: the next tap is a real tap.
    const second = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    result.current.suppressClick(second as unknown as React.MouseEvent);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it('lets an ordinary tap through', () => {
    const { result } = renderHook(() => useSwipeToComplete(vi.fn()));
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    act(() => {
      down(result.current.handlers, pointer(10, 10));
      up(result.current.handlers, pointer(10, 10));
    });

    result.current.suppressClick(click as unknown as React.MouseEvent);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });
});
