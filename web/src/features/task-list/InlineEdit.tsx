import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface InlineTextProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Renders bold, for main task titles. */
  emphasis?: boolean;
  multiline?: boolean;
  /**
   * Show the whole value on as many lines as it needs, instead of cutting it
   * off with an ellipsis. For task titles, which are the thing people read.
   */
  wrap?: boolean;
  /**
   * Mount straight into edit mode.
   *
   * For a field whose full value had to be fetched first: the placeholder that
   * stood in while it loaded is swapped for this, and the user carries on typing
   * rather than clicking a second time. Only read on mount, which is what makes
   * the swap the trigger.
   */
  autoEdit?: boolean;
}

/**
 * The resting look of a click-to-edit cell. Two jobs, neither of which the
 * previous styling did.
 *
 * **Have a hit area even when empty.** `min-h-6` is what a populated cell
 * already measures, so nothing moves — but an empty one collapsed to its 4px of
 * padding inside a 40px row. Clickable in the sense that a 4px ribbon is
 * clickable: aiming at the middle of the cell hit nothing at all.
 *
 * **Look like a field.** The old cue was `hover:bg-surface-hover`, and
 * `--surface-hover` is the same value the row hover uses — so by the time the
 * pointer was over a cell, its row had already painted that colour and the
 * cell's own hover changed nothing visible. An inset panel with a border reads
 * as somewhere to type against either row state, in both themes.
 */
const FIELD_BASE =
  'w-full min-h-6 rounded border border-transparent px-1 py-0.5 text-left transition-colors duration-150 hover:border-border-strong hover:bg-surface disabled:cursor-not-allowed disabled:hover:border-transparent';

export const FIELD = `${FIELD_BASE} truncate`;

/**
 * The same field, showing all of its text.
 *
 * `overflow-wrap: anywhere` rather than `break-words`, because a grid cell
 * sizes itself by its longest unbreakable run: a pasted URL or a part number
 * with no spaces would otherwise push the column wider instead of wrapping.
 */
export const FIELD_WRAP = `${FIELD_BASE} whitespace-normal [overflow-wrap:anywhere]`;

/**
 * Click-to-edit text, used for Uppgift and Kommentarer.
 *
 * Commits on blur and on Enter; Escape abandons. The draft is local state and
 * is only sent when it actually differs, so a click that lands on a cell and
 * leaves again does not generate a write — which matters when every write is a
 * conditional blob PUT that can conflict.
 */
export function InlineText({
  value,
  onCommit,
  placeholder,
  className = '',
  ariaLabel,
  disabled,
  emphasis,
  multiline,
  wrap,
  autoEdit,
}: InlineTextProps) {
  const [editing, setEditing] = useState(autoEdit === true);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  // If the value changes underneath us — someone else's edit arriving — adopt
  // it, but never while the user is typing into this field.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  /*
    A wrapping editor grows with its text.

    Measured rather than left to `rows`, so the editor is exactly as tall as the
    text it replaced and the row does not jump when a title is clicked. The
    caret goes to the end on entry: a textarea focuses with it at the start,
    which is the wrong end for the usual edit — adding a few words.
  */
  const growing = editing && wrap === true && multiline !== true;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!growing || element === null) return;
    element.style.height = 'auto';
    // +2 for the border, which `scrollHeight` leaves out.
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [growing, draft]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (growing && element !== null) {
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [growing]);

  const commit = (): void => {
    setEditing(false);
    // A wrapped title is still one line of text: a pasted line break becomes a
    // space rather than a title that silently spans two lines.
    const trimmed = multiline === true ? draft : draft.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (trimmed !== value) onCommit(trimmed);
  };

  const cancel = (): void => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        /*
          The label belongs on the display button too, not only on the editor it
          opens. It was passed to the input alone, so a cell with no text and no
          placeholder was a button with no accessible name whatsoever — a screen
          reader announced "button", and nothing could address it by name.
        */
        aria-label={ariaLabel}
        className={`${wrap === true ? FIELD_WRAP : FIELD} ${
          emphasis === true ? 'font-semibold text-content' : 'text-content'
        } ${className}`}
        title={value.length > 0 ? value : placeholder}
      >
        {/*
          The placeholder is a child rather than a colour on the button, because
          a caller's `className` can carry a text colour of its own and which of
          two equal-specificity utilities wins is decided by Tailwind's emission
          order, not by the order they appear in here. A span always inherits
          last, so a placeholder can never end up as dark as real content.
        */}
        {value.length > 0 ? (
          value
        ) : (
          <span className="text-content-muted/60">{placeholder ?? ''}</span>
        )}
      </button>
    );
  }

  const shared = {
    autoFocus: true,
    value: draft,
    'aria-label': ariaLabel,
    onBlur: commit,
    // A wrapping editor keeps the size of the text it replaces, so entering it
    // neither reflows the lines nor changes the row's height.
    className: `w-full rounded border border-accent bg-surface px-1 py-0.5 text-content outline-none ${
      wrap === true ? '' : 'text-sm'
    } ${emphasis === true ? 'font-semibold' : ''} ${className}`,
  };

  if (wrap === true && multiline !== true) {
    return (
      <textarea
        {...shared}
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        rows={1}
        className={`${shared.className} block resize-none overflow-hidden [overflow-wrap:anywhere]`}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits, exactly as in the single-line editor this stands in
          // for. A title has no line breaks to type.
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  if (multiline === true) {
    return (
      <textarea
        {...shared}
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
          // Enter inserts a newline here; Kommentarer is multi-line by nature.
          // Ctrl/Cmd+Enter commits.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <input
      {...shared}
      ref={ref as React.RefObject<HTMLInputElement>}
      type="text"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

interface InlineDateProps {
  value: string | null;
  onCommit: (value: string | null) => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Renders muted and shows an em dash when empty — used for Färdig datum. */
  subtle?: boolean;
}

/**
 * Click-to-edit date.
 *
 * Färdig datum looks read-only until clicked, because it is normally filled in
 * automatically — but it must stay editable, since a user correcting a
 * completion date should never have it stomped.
 */
export function InlineDate({ value, onCommit, ariaLabel, disabled, subtle }: InlineDateProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={value ?? ''}
        aria-label={ariaLabel}
        onBlur={(event) => {
          setEditing(false);
          const next = event.target.value.length === 0 ? null : event.target.value;
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setEditing(false);
        }}
        className="w-full rounded border border-accent bg-surface px-1 py-0.5 text-xs text-content outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      aria-label={ariaLabel}
      className={`${FIELD} text-xs tabular-nums ${
        subtle === true ? 'text-content-muted' : 'text-content'
      }`}
    >
      {value ?? <span className="text-content-muted">—</span>}
    </button>
  );
}
