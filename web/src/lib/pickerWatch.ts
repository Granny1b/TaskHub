/**
 * Notice when the page was destroyed while a file picker was open.
 *
 * Tapping "Foto" on Android hands control to the camera app, which needs a
 * great deal of memory — a 50MP sensor capture is hundreds of megabytes before
 * anything is saved. Android frees that memory by killing background processes,
 * and a browser holding dozens of tabs is the obvious candidate. The tab's
 * renderer dies, the browser shows its own "för lite minne" message, and when
 * the page comes back it has been reloaded from scratch.
 *
 * The photograph never reaches JavaScript in that case. No amount of care in
 * the upload pipeline helps, because the pipeline never runs — which is exactly
 * why two rounds of fixes to it changed nothing.
 *
 * What *can* be done is stop the app looking broken. A marker is written before
 * the picker opens and cleared when it returns; finding it at startup means the
 * page died in between, and that is worth explaining, with the two workarounds
 * that actually work.
 *
 * `sessionStorage` is the right store: it survives a reload of the same tab and
 * does not leak to other tabs or outlive the session.
 */

const KEY = 'taskhub.pickerOpen';

export function markPickerOpen(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    /* Private browsing. The detection is a nicety, not a requirement. */
  }
}

export function clearPickerOpen(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* As above. */
  }
}

/**
 * Was a picker open when this page last stopped running?
 *
 * Consumes the marker, so the explanation is shown once rather than on every
 * subsequent navigation.
 */
export function consumePickerInterrupted(): boolean {
  try {
    const found = window.sessionStorage.getItem(KEY) !== null;
    if (found) window.sessionStorage.removeItem(KEY);
    return found;
  } catch {
    return false;
  }
}
