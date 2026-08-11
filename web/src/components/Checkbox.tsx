import { CheckIcon } from './icons.js';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Bumps the hit area to 44px for touch, without changing the visual size. */
  touchTarget?: boolean;
}

/**
 * The completion checkbox — the single most-used control in the app.
 *
 * A real `<input type="checkbox">` underneath, visually replaced. Keeping the
 * native input means keyboard behaviour, form semantics and screen-reader
 * announcements come for free and cannot drift.
 *
 * The hit area is deliberately larger than the box: this is a dense list and
 * the target would otherwise be about 16px, which is unusable on a phone and
 * fiddly with a mouse.
 */
export function Checkbox({ checked, onChange, label, disabled, touchTarget }: CheckboxProps) {
  return (
    <label
      className={`group relative inline-flex cursor-pointer items-center justify-center ${
        touchTarget === true ? 'h-11 w-11' : 'h-8 w-8'
      } ${disabled === true ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition-colors duration-150 ${
          checked
            ? 'border-[var(--success-600)] bg-[var(--success-500)] text-white'
            : 'border-border-control bg-surface group-hover:border-accent'
        } peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]`}
      >
        {checked ? <CheckIcon className="h-3.5 w-3.5" /> : null}
      </span>
    </label>
  );
}
