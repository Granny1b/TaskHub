/**
 * Icons as inline SVG.
 *
 * A dozen 20px glyphs do not justify an icon library: the smallest of them adds
 * more to the bundle than this file, and tree-shaking icon packs is a recurring
 * chore. These inherit `currentColor`, so they follow the token layer for free.
 */

interface IconProps {
  className?: string;
  'aria-hidden'?: boolean;
}

const base = 'h-4 w-4 shrink-0';

export function ChevronRightIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M7.5 5l5 5-5 5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M10 4.5v11M4.5 10h11" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function PaperclipIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M13.5 7.5l-5 5a2.12 2.12 0 003 3l5-5a4.24 4.24 0 00-6-6l-5 5a6.36 6.36 0 009 9l4.5-4.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M4 6h12M8 6V4.5h4V6M6 6l.75 9.5h6.5L14 6M8.5 9v4M11.5 9v4"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MenuIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 6h14M3 10h14M3 14h14" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M5 5l10 10M15 5L5 15" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="9" cy="9" r="5" strokeWidth="1.75" />
      <path d="M13 13l4 4" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function ListIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M7 6h10M7 10h10M7 14h10" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="3.75" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.75" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.75" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InboxIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M3 11l2-6h10l2 6v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 11h4l1 2h4l1-2h4" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowLeftIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M12 5l-5 5 5 5M7 10h10"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PanelIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <rect x="3" y="4" width="14" height="12" rx="2" strokeWidth="1.5" />
      <path d="M8 4v12" strokeWidth="1.5" />
    </svg>
  );
}

export function CheckIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M5 10.5l3.5 3.5L15 6.5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** An arrow curving back on itself: undo, reopen, put it back. */
export function UndoIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M4 9h8a4 4 0 010 8H7"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 5.5L3.5 9 7 12.5"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two chevrons meeting in the middle: fold everything shut. */
export function CollapseIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M6 8.5L10 4.5l4 4M6 11.5l4 4 4-4"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Six dots: the near-universal "grab me" affordance for a reorderable row. */
export function GripIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <circle cx="7.5" cy="5" r="1.35" />
      <circle cx="12.5" cy="5" r="1.35" />
      <circle cx="7.5" cy="10" r="1.35" />
      <circle cx="12.5" cy="10" r="1.35" />
      <circle cx="7.5" cy="15" r="1.35" />
      <circle cx="12.5" cy="15" r="1.35" />
    </svg>
  );
}

export function PersonIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="10" cy="7" r="3" strokeWidth="1.5" />
      <path d="M4 16.5a6 6 0 0112 0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
