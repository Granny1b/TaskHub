import { useCallback, useEffect, useState } from 'react';

/**
 * Task list columns, mirroring the source workbook left to right so the tool is
 * instantly familiar (§10).
 *
 * Widths are persisted per user because column sizing is a personal working
 * preference, not shared configuration — one person's comfortable Kommentarer
 * column is another's wasted space.
 */

export type ColumnId =
  | 'expand'
  | 'complete'
  | 'date'
  | 'title'
  | 'comments'
  | 'status'
  | 'completedDate'
  | 'affordances';

export interface ColumnDefinition {
  readonly id: ColumnId;
  readonly labelKey: string | null;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly resizable: boolean;
  /** Takes a share of the remaining space rather than a fixed width. */
  readonly flexible?: boolean;
  /** Relative share when flexible. Uppgift gets more room than Kommentarer. */
  readonly flexGrow?: number;
  /** Hidden below the md breakpoint, where the row collapses to a card. */
  readonly desktopOnly?: boolean;
}

export const COLUMNS: readonly ColumnDefinition[] = [
  { id: 'expand', labelKey: null, defaultWidth: 28, minWidth: 28, resizable: false },
  {
    id: 'complete',
    labelKey: 'columns.complete',
    defaultWidth: 36,
    minWidth: 36,
    resizable: false,
  },
  { id: 'date', labelKey: 'columns.date', defaultWidth: 108, minWidth: 90, resizable: true },
  /**
   * Uppgift and Kommentarer share the slack, with the title taking the larger
   * share. Making them flexible rather than fixed is what stops a wide screen
   * truncating titles while leaving whitespace elsewhere. Resizing applies to
   * the fixed columns; these two follow the window.
   */
  {
    id: 'title',
    labelKey: 'columns.title',
    defaultWidth: 300,
    minWidth: 160,
    resizable: false,
    flexible: true,
    flexGrow: 1.6,
  },
  /**
   * Kommentarer absorbs the slack. It is the free-text field, so extra width
   * does the most good here — and making one column flexible is what stops the
   * grid overflowing its container at narrow desktop widths.
   */
  {
    id: 'comments',
    labelKey: 'columns.comments',
    defaultWidth: 220,
    minWidth: 120,
    resizable: false,
    flexible: true,
    flexGrow: 1,
    desktopOnly: true,
  },
  {
    id: 'status',
    labelKey: 'columns.status',
    defaultWidth: 150,
    minWidth: 130,
    resizable: true,
    desktopOnly: true,
  },
  {
    id: 'completedDate',
    labelKey: 'columns.completedDate',
    defaultWidth: 110,
    minWidth: 96,
    resizable: true,
    desktopOnly: true,
  },
  { id: 'affordances', labelKey: null, defaultWidth: 92, minWidth: 92, resizable: false },
];

const STORAGE_KEY = 'taskhub.columnWidths';

export type ColumnWidths = Partial<Record<ColumnId, number>>;

function readStored(): ColumnWidths {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as ColumnWidths;
  } catch {
    // Corrupt or unavailable storage must never stop the app rendering.
    return {};
  }
}

export function useColumnWidths() {
  const [widths, setWidths] = useState<ColumnWidths>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      /* Private browsing or a full quota. Not worth interrupting the user. */
    }
  }, [widths]);

  const setWidth = useCallback((id: ColumnId, width: number) => {
    const column = COLUMNS.find((candidate) => candidate.id === id);
    if (column === undefined) return;
    setWidths((current) => ({ ...current, [id]: Math.max(column.minWidth, Math.round(width)) }));
  }, []);

  const reset = useCallback(() => setWidths({}), []);

  const widthOf = useCallback(
    (column: ColumnDefinition): number => widths[column.id] ?? column.defaultWidth,
    [widths],
  );

  /**
   * CSS grid template for the row and header, so the two cannot drift apart.
   *
   * Exactly one column is `1fr`; every other is a fixed pixel width. That is
   * what keeps the total equal to the container rather than the sum of the
   * columns — an all-fixed grid overflows and clips the right-hand columns.
   */
  const gridTemplate = useCallback(
    (options: { compact: boolean }): string =>
      COLUMNS.filter((column) => !(options.compact && column.desktopOnly === true))
        .map((column) =>
          column.flexible === true
            ? `minmax(${column.minWidth}px, ${column.flexGrow ?? 1}fr)`
            : `${widthOf(column)}px`,
        )
        .join(' '),
    [widthOf],
  );

  return { widths, setWidth, reset, widthOf, gridTemplate };
}
