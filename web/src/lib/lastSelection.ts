/**
 * Remember which section of the left panel was open.
 *
 * The selection used to be plain component state, so every reload put the user
 * back on "Alla uppgifter" — working in one list all day meant re-selecting it
 * after every refresh. It is a per-device habit rather than a fact about the
 * work, so it lives in localStorage beside the other personal preferences.
 *
 * The type is declared here rather than imported from the panel so this module
 * stays free of React and can be tested on its own; the panel's `ListSelection`
 * is structurally the same thing.
 */
export type StoredSelection =
  { kind: 'all' } | { kind: 'ungrouped' } | { kind: 'list'; id: string } | { kind: 'files' };

const STORAGE_KEY = 'taskhub.selection';
const FALLBACK: StoredSelection = { kind: 'all' };

/**
 * Turn whatever was stored back into a selection.
 *
 * Anything unrecognised becomes "all": the value is written by this app, but
 * it is read back by whichever later version happens to load, and a section
 * that no longer exists must not leave the app showing nothing.
 */
export function parseSelection(raw: string | null): StoredSelection {
  if (raw === null) return FALLBACK;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return FALLBACK;

    const { kind, id } = parsed as { kind?: unknown; id?: unknown };
    if (kind === 'all' || kind === 'ungrouped' || kind === 'files') return { kind };
    if (kind === 'list' && typeof id === 'string' && id.length > 0) return { kind, id };
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function readSelection(): StoredSelection {
  if (typeof window === 'undefined') return FALLBACK;
  try {
    return parseSelection(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return FALLBACK;
  }
}

export function writeSelection(selection: StoredSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* Private browsing: the selection still holds for this session. */
  }
}

/**
 * The selection to actually show, given the lists that exist.
 *
 * A remembered list can be gone by the next visit — deleted here, or on another
 * device. Pointing at it would show an empty list under a heading for nothing,
 * so it falls back to "all". `listIds` is undefined until the lists have
 * loaded, and until then the remembered selection is trusted: falling back
 * early would throw away a perfectly good list on every reload.
 */
export function resolveSelection(
  selection: StoredSelection,
  listIds: readonly string[] | undefined,
): StoredSelection {
  if (selection.kind !== 'list' || listIds === undefined) return selection;
  return listIds.includes(selection.id) ? selection : FALLBACK;
}
