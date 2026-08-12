import { useCallback, useEffect, useState } from 'react';

/**
 * Personal preferences.
 *
 * Per-user and per-device, held in localStorage rather than on the task
 * document: how someone likes to *see* their work is not a fact about the work.
 * Two people looking at the same task should be able to disagree about whether
 * subtasks belong inline or in the pane.
 *
 * Kept deliberately separate from `features.ts`, which is build-time
 * configuration the user cannot change.
 */

/**
 * Where subtasks live.
 *
 * `inline` — expanded underneath their parent in the list, as in the source
 *            workbook. Familiar, and keeps everything on one screen.
 * `detail` — only in the detail pane. A cleaner list when there are many
 *            subtasks, at the cost of a click to see them.
 */
export type SubtaskDisplay = 'inline' | 'detail';

/**
 * What happens to a photograph on its way up.
 *
 * `balanced` — resized to 2560px and re-encoded. Far smaller, and still more
 *              detail than any screen in the building can show at once.
 * `original` — uploaded byte for byte. For the occasion where the photograph
 *              *is* the measurement and full resolution is the point.
 */
export type ImageQuality = 'balanced' | 'original';

export interface Preferences {
  readonly subtaskDisplay: SubtaskDisplay;
  /** Compact is the dense working list; comfortable adds breathing room. */
  readonly rowDensity: 'compact' | 'comfortable';
  /** Show the Kommentarer column in the list. */
  readonly showComments: boolean;
  /** Whether photographs are shrunk before upload. */
  readonly imageQuality: ImageQuality;
}

export const DEFAULT_PREFERENCES: Preferences = {
  // Matches the workbook people are migrating from, so nothing has moved on
  // day one.
  subtaskDisplay: 'inline',
  rowDensity: 'compact',
  showComments: true,
  // Compressing by default is the choice that keeps the bill under €2/month
  // without anyone having to know the setting exists.
  imageQuality: 'balanced',
};

const STORAGE_KEY = 'taskhub.preferences';

/**
 * Read stored preferences, field by field.
 *
 * Merging each key against the defaults rather than trusting the stored object
 * wholesale means a preference added in a later release does not arrive as
 * `undefined` for everyone who already has a stored blob.
 */
export function readPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PREFERENCES;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFERENCES;
    const stored = parsed as Partial<Preferences>;

    return {
      subtaskDisplay:
        stored.subtaskDisplay === 'detail' || stored.subtaskDisplay === 'inline'
          ? stored.subtaskDisplay
          : DEFAULT_PREFERENCES.subtaskDisplay,
      rowDensity:
        stored.rowDensity === 'comfortable' || stored.rowDensity === 'compact'
          ? stored.rowDensity
          : DEFAULT_PREFERENCES.rowDensity,
      showComments:
        typeof stored.showComments === 'boolean'
          ? stored.showComments
          : DEFAULT_PREFERENCES.showComments,
      imageQuality:
        stored.imageQuality === 'original' || stored.imageQuality === 'balanced'
          ? stored.imageQuality
          : DEFAULT_PREFERENCES.imageQuality,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Preferences are read by several components at once (the list, the rows, the
 * settings dialog), so changes are broadcast rather than lifted into a context
 * — the alternative is threading state through every layer for something that
 * changes a handful of times in a user's life.
 */
const listeners = new Set<(preferences: Preferences) => void>();

export function setPreferences(update: Partial<Preferences>): void {
  const next = { ...readPreferences(), ...update };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Private browsing: the change still applies for this session. */
  }
  for (const listener of listeners) listener(next);
}

export function usePreferences(): [Preferences, (update: Partial<Preferences>) => void] {
  const [preferences, setLocal] = useState<Preferences>(readPreferences);

  useEffect(() => {
    listeners.add(setLocal);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => setPreferences(patch), []);

  return [preferences, update];
}
