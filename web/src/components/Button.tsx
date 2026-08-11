import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

/**
 * The brand blue appears here and on active nav, focus rings and the selected
 * row — accent only. It never becomes a full-width band across the table, which
 * is the single strongest "this is a spreadsheet" signal.
 *
 * Note that `--accent` resolves to a darkened brand shade on light surfaces:
 * the raw brand hex measures 2.62:1 on white and fails contrast even for
 * non-text. See docs/TOKENS.md.
 */
const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-contrast hover:bg-accent-hover border border-transparent font-medium',
  secondary: 'bg-surface text-content border border-border-strong hover:bg-surface-hover',
  ghost:
    'bg-transparent text-content-muted hover:bg-surface-hover hover:text-content border border-transparent',
  danger:
    'bg-transparent text-[var(--danger-500)] hover:bg-surface-hover border border-transparent',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-9 px-3 text-sm gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  /** 44px hit area for touch contexts. */
  touchTarget?: boolean;
}

export function IconButton({
  label,
  children,
  className = '',
  touchTarget,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-md text-content-muted transition-colors duration-150 hover:bg-surface-hover hover:text-content disabled:cursor-not-allowed disabled:opacity-50 ${
        touchTarget === true ? 'h-11 w-11' : 'h-7 w-7'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
