import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The one way a subtask gets typed, wherever you are.
 *
 * It lives in its own file because three places need it — the desktop row, the
 * phone card and the detail pane — and until they shared it they each did
 * something different. The pane in particular used `window.prompt`, which is
 * unstyled, cannot be cancelled with anything but its own buttons, and is
 * suppressed outright by some mobile browsers.
 *
 * Enter commits, Escape cancels, and blurring commits what is there rather
 * than throwing it away — a half-typed subtask lost to a stray click is the
 * kind of small betrayal that stops people trusting inline editing.
 */
export function NewSubtaskInput({
  className,
  onCreate,
  onCancel,
}: {
  /** Placement, which differs per surface: grid indent, card indent, pane. */
  className?: string;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  return (
    <div className={className ?? ''}>
      <input
        autoFocus
        value={value}
        placeholder={t('task.titlePlaceholder')}
        aria-label={t('task.newSubtask')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim().length > 0) onCreate(value.trim());
          else onCancel();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim().length > 0) {
            event.preventDefault();
            onCreate(value.trim());
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full max-w-md rounded border border-accent bg-surface px-2 py-1 text-sm text-content outline-none"
      />
    </div>
  );
}
