import { useTranslation } from 'react-i18next';
import { CheckIcon, UndoIcon } from '../../components/icons.js';
import { useSwipeToComplete } from '../../lib/useSwipeToComplete.js';

/** Width at which the band is wide enough to hold a word as well as an icon. */
const LABEL_AT = 76;

interface SwipeRowProps {
  /** Current completion, which decides what the gesture will do. */
  complete: boolean;
  onToggle: (next: boolean) => void;
  /** Off while a reorder drag is in flight, so the two never fight. */
  enabled?: boolean;
  children: React.ReactNode;
}

/**
 * A row that can be swiped right to tick off, and swiped right again to reopen.
 *
 * One direction, not two. A second gesture would need a second thing to mean,
 * and the only other candidate here is delete — which is exactly the action
 * that should not be one careless thumb away. The band underneath says what
 * letting go will do, so the same gesture can safely mean both "done" and
 * "not done after all".
 *
 * The band only becomes solid once the row has travelled far enough to act.
 * Below that it is faint, which is what tells a thumb it has not gone far
 * enough — without it the gesture has no failure state you can see.
 */
export function SwipeRow({ complete, onToggle, enabled = true, children }: SwipeRowProps) {
  const { t } = useTranslation();
  const swipe = useSwipeToComplete(() => onToggle(!complete), enabled);

  const label = complete ? t('swipe.reopen') : t('swipe.complete');

  return (
    <div className="relative overflow-hidden">
      {/* Revealed behind the row. Decorative: the checkbox is what a screen
          reader reads, and it says the same thing. */}
      {swipe.offset > 0 ? (
        <div
          aria-hidden
          className={`absolute inset-y-0 left-0 flex items-center justify-end gap-2 pr-3 text-sm font-medium transition-colors duration-150 ${
            swipe.armed
              ? // The 600 step, not 500: this band carries a word, and at 500
                // white on it measures 3.2–3.3:1 — fine for a shape, short of
                // the 4.5:1 text needs (docs/TOKENS.md).
                complete
                ? 'bg-[var(--warning-600)] text-white'
                : 'bg-[var(--success-600)] text-white'
              : 'bg-surface-sunken text-content-muted'
          }`}
          style={{ width: swipe.offset }}
        >
          {/*
            Anchored to the card's edge and revealed as it moves away, so the
            icon arrives first and the label joins it once there is room. Left
            alignment instead would clip the word to a fragment on a short
            swipe, which reads as a rendering bug rather than a hint.
          */}
          {swipe.offset >= LABEL_AT ? <span className="whitespace-nowrap">{label}</span> : null}
          <span className="shrink-0">
            {complete ? <UndoIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
          </span>
        </div>
      ) : null}

      <div
        {...swipe.handlers}
        onClickCapture={swipe.suppressClick}
        style={{
          transform: swipe.offset > 0 ? `translateX(${swipe.offset}px)` : undefined,
          // Only while the finger is down. On release the row springs back, and
          // a transition during the drag would make it lag the thumb.
          transition: swipe.swiping ? undefined : 'transform 180ms ease-out',
          // Vertical panning belongs to the browser; horizontal comes here.
          touchAction: 'pan-y',
        }}
        className="relative bg-surface"
      >
        {children}
      </div>
    </div>
  );
}
