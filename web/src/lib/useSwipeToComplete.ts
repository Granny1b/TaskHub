import { useCallback, useRef, useState } from 'react';

/**
 * Swipe a row sideways to tick it off (§11 — mobile).
 *
 * Built on pointer events rather than a library: the whole gesture is forty
 * lines, and the interesting part is not the maths but how it shares the screen
 * with everything else a finger can do to this row.
 *
 * Three gestures overlap on a task card, and each has to stay reachable:
 *
 *  - **Scrolling the list.** `touch-action: pan-y` on the swiped element hands
 *    vertical panning to the browser, so a finger dragged down the page scrolls
 *    it and never reaches this hook. Only horizontal movement arrives here.
 *  - **Dragging to reorder.** Its listeners live on the grip alone and it waits
 *    220ms before activating, so a swipe — which starts moving immediately —
 *    cancels it on the tolerance check before it ever begins.
 *  - **Tapping to open the task.** A gesture that turned into a swipe has to
 *    swallow the click it would otherwise end with, or every swipe would also
 *    open the detail pane. That is what `suppressClick` is for.
 *
 * Mouse pointers are ignored outright. This is a touch affordance on a layout
 * that only exists on a phone, and a mouse has the checkbox.
 */

/** How far the row must travel before letting go acts on the task. */
export const SWIPE_THRESHOLD = 88;

/** Past the threshold the row keeps moving, but grudgingly. */
const RESISTANCE = 0.35;
const MAX_OFFSET = 132;

/** Movement before the gesture commits to an axis. */
const AXIS_LOCK = 8;

function travel(dx: number): number {
  // Only rightward. A left swipe is not a second action here, and letting the
  // row move that way would promise one.
  if (dx <= 0) return 0;
  const eased = dx <= SWIPE_THRESHOLD ? dx : SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * RESISTANCE;
  return Math.min(eased, MAX_OFFSET);
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** A gesture that turns out to be vertical is dropped, not tracked. */
  axis: 'undecided' | 'horizontal';
}

export interface SwipeToComplete {
  /** Current travel in px. Drive a `translateX` with it. */
  readonly offset: number;
  /** True while a finger is down and the gesture has locked horizontal. */
  readonly swiping: boolean;
  /** True once the row has travelled far enough that letting go will act. */
  readonly armed: boolean;
  readonly handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** Put on the swiped element as `onClickCapture`. */
  readonly suppressClick: (event: React.MouseEvent) => void;
}

export function useSwipeToComplete(onCommit: () => void, enabled = true): SwipeToComplete {
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const gesture = useRef<Gesture | null>(null);
  // The live values. State lags by a render, and the decision to commit is made
  // in the same tick the finger lifts.
  const offsetRef = useRef(0);
  const swipedRef = useRef(false);

  const move = useCallback((next: number) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType === 'mouse') return;
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: 'undecided',
      };
      swipedRef.current = false;
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current === null || current.pointerId !== event.pointerId) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (current.axis === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        // Ties go to scrolling. Being wrong about a swipe costs a tap; being
        // wrong about a scroll makes the list feel stuck. Dropping the gesture
        // is what stops a later sideways wobble resurrecting the swipe.
        if (Math.abs(dx) <= Math.abs(dy)) {
          gesture.current = null;
          return;
        }
        current.axis = 'horizontal';
        setSwiping(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      if (dx > AXIS_LOCK) swipedRef.current = true;
      move(travel(dx));
    },
    [move],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>, commit: boolean) => {
      const current = gesture.current;
      if (current === null || current.pointerId !== event.pointerId) return;
      gesture.current = null;

      const reached = offsetRef.current >= SWIPE_THRESHOLD;
      setSwiping(false);
      move(0);

      if (commit && reached) onCommit();
    },
    [move, onCommit],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => finish(event, true),
    [finish],
  );
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => finish(event, false),
    [finish],
  );

  const suppressClick = useCallback((event: React.MouseEvent) => {
    if (!swipedRef.current) return;
    swipedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    offset,
    swiping,
    armed: offset >= SWIPE_THRESHOLD,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    suppressClick,
  };
}
