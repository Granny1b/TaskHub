import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clampPercent, countChildren, type TaskNode } from '@taskhub/shared';
import { useFocusTrap } from '../../lib/useFocusTrap.js';

interface PercentControlProps {
  node: TaskNode;
  onChangePercent: (percent: number) => void;
  onBackToAuto: () => void;
  disabled?: boolean;
  /** Phones get a bottom sheet instead of an inline input. */
  onOpenSheet?: () => void;
}

/**
 * The Status column for main tasks (§10, "The percent control").
 *
 * Two rules from the domain surface directly in what this renders:
 *
 * - **The percent stays visible when the task is complete.** A completed task
 *   shows `✓ 40%`, not a full bar implying 100%. The UI must never suggest data
 *   we do not hold.
 * - **Editing flips the source to manual, permanently.** The "auto" affordance
 *   is the only way back, and it is deliberately explicit rather than something
 *   that happens on its own.
 *
 * The control renders nothing for checkbox nodes: a subtask's completion is its
 * checkbox, and the Status cell is empty by design.
 */
export function PercentControl({
  node,
  onChangePercent,
  onBackToAuto,
  disabled,
  onOpenSheet,
}: PercentControlProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (node.completion.kind !== 'percent') return null;

  const { percent, isComplete, percentSource } = node.completion;
  const isDerived = percentSource === 'derived';
  const { total, done } = countChildren(node);

  const commit = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10);
    setEditing(false);
    if (Number.isNaN(parsed)) return;
    const next = clampPercent(parsed);
    if (next !== percent) onChangePercent(next);
  };

  const startEditing = (): void => {
    if (disabled === true) return;
    if (onOpenSheet !== undefined) {
      // A 6px bar is not a touch target; phones get a sheet with a slider.
      onOpenSheet();
      return;
    }
    setDraft(String(percent));
    setEditing(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Arrows step by 5, Shift+arrow by 1 — coarse adjustment is the common
    // case, so it gets the unmodified key.
    const step = event.shiftKey ? 1 : 5;
    const current = Number.parseInt(draft, 10);
    const from = Number.isNaN(current) ? percent : current;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      setDraft(String(clampPercent(from + step)));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setDraft(String(clampPercent(from - step)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={draft}
          aria-label={t('percent.label')}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          className="h-6 w-14 rounded border border-accent bg-surface px-1.5 text-right text-xs tabular-nums text-content outline-none"
        />
        <span className="text-xs text-content-muted">%</span>
      </div>
    );
  }

  const ratioLabel = t('percent.derivedFrom', { done, total });

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={startEditing}
        disabled={disabled}
        className="group flex flex-1 items-center gap-2 rounded px-1 py-1 text-left transition-colors duration-150 hover:bg-surface-hover disabled:cursor-not-allowed"
        title={isDerived && total > 0 ? ratioLabel : t('percent.label')}
      >
        <span
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('percent.label')}
          className="relative h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-surface-sunken"
        >
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ${
              isComplete ? 'bg-[var(--success-500)]' : 'bg-accent'
            }`}
            // A completed task renders the bar full in the success colour, but
            // the real number stays beside it — see the muted text below.
            style={{ width: `${isComplete ? 100 : percent}%` }}
          />
        </span>

        <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
          {isComplete ? (
            <>
              <span className="text-[var(--success-600)]">✓</span>
              <span className="text-content-muted">{percent}%</span>
            </>
          ) : (
            <span className="text-content">{percent}%</span>
          )}
        </span>
      </button>

      {isDerived && total > 0 ? (
        <span
          className="shrink-0 rounded bg-surface-sunken px-1 text-[10px] uppercase tracking-wide text-content-muted"
          title={ratioLabel}
        >
          {t('percent.auto')}
        </span>
      ) : null}

      {!isDerived && total > 0 ? (
        <button
          type="button"
          onClick={onBackToAuto}
          disabled={disabled}
          className="shrink-0 rounded px-1 text-[10px] uppercase tracking-wide text-accent underline-offset-2 hover:underline"
          title={t('percent.backToAuto')}
        >
          {t('percent.auto')}
        </button>
      ) : null}
    </div>
  );
}

interface PercentSheetProps {
  node: TaskNode;
  onClose: () => void;
  onChangePercent: (percent: number) => void;
}

/**
 * Mobile percent editor.
 *
 * A slider plus quick-set chips, in a bottom sheet within thumb reach. The
 * chips exist because dragging a slider to exactly 25 is fiddly and the
 * quarters are what people actually pick.
 */
export function PercentSheet({ node, onClose, onChangePercent }: PercentSheetProps) {
  const { t } = useTranslation();
  const initial = node.completion.kind === 'percent' ? node.completion.percent : 0;
  const [value, setValue] = useState(initial);
  const sheetRef = useRef<HTMLDivElement>(null);

  useFocusTrap(sheetRef, true, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t('percent.label')}
    >
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="relative rounded-t-xl border-t border-border-subtle bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" aria-hidden />

        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-sm font-medium text-content">{t('percent.label')}</span>
          <span className="text-lg tabular-nums text-content">{value}%</span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label={t('percent.label')}
          onChange={(event) => setValue(Number(event.target.value))}
          className="h-11 w-full accent-[var(--accent)]"
        />

        <div className="mt-3 grid grid-cols-5 gap-2">
          {[0, 25, 50, 75, 100].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setValue(chip)}
              className={`h-11 rounded-md border text-sm tabular-nums transition-colors ${
                value === chip
                  ? 'border-accent bg-surface-selected text-content'
                  : 'border-border-subtle text-content-muted'
              }`}
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-md border border-border-strong text-sm text-content"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              onChangePercent(clampPercent(value));
              onClose();
            }}
            className="h-11 flex-1 rounded-md bg-accent text-sm font-medium text-accent-contrast"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
