import { useEffect, useRef, useState } from 'react';

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

  const commit = (): void => {
    setEditing(false);
    const trimmed = multiline === true ? draft : draft.trim();
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
        className={`w-full truncate rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-surface-hover disabled:cursor-not-allowed ${
          emphasis === true ? 'font-semibold text-content' : 'text-content'
        } ${value.length === 0 ? 'text-content-muted' : ''} ${className}`}
        title={value.length > 0 ? value : placeholder}
      >
        {value.length > 0 ? value : (placeholder ?? '')}
      </button>
    );
  }

  const shared = {
    autoFocus: true,
    value: draft,
    'aria-label': ariaLabel,
    onBlur: commit,
    className: `w-full rounded border border-accent bg-surface px-1 py-0.5 text-sm text-content outline-none ${className}`,
  };

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
      className={`w-full truncate rounded px-1 py-0.5 text-left text-xs tabular-nums transition-colors duration-150 hover:bg-surface-hover disabled:cursor-not-allowed ${
        subtle === true ? 'text-content-muted' : 'text-content'
      }`}
    >
      {value ?? <span className="text-content-muted">—</span>}
    </button>
  );
}
