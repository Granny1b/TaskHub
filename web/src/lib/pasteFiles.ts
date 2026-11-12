/**
 * Turn a paste into files worth attaching.
 *
 * Snip, Ctrl+V, done — that is the whole point, and it is the flow people use
 * when the alternative is save-to-disk-then-browse. Two details decide whether
 * it is pleasant or surprising, and both are settled here rather than in the
 * component so they can be tested without a browser.
 */

/** What the clipboard looked like, reduced to what the rules need. */
export interface PasteInput {
  readonly files: readonly File[];
  /** The plain text on the clipboard, or '' when there is none. */
  readonly text: string;
  /** True when the paste landed in a field the user is typing in. */
  readonly intoEditable: boolean;
}

/**
 * A filename for a pasted screenshot.
 *
 * Clipboard images arrive as `image.png` or with no name at all, so a paste of
 * three screenshots would otherwise produce three identically-named
 * attachments. The timestamp makes them distinguishable in the list.
 */
export function pastedFileName(contentType: string, at: Date = new Date()): string {
  const extension = contentType === 'image/jpeg' ? 'jpg' : (contentType.split('/')[1] ?? 'png');
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `skarmklipp-${stamp}.${extension.length > 0 ? extension : 'png'}`;
}

/** The names a browser invents for clipboard images, which say nothing. */
function isPlaceholderName(name: string): boolean {
  return name.trim().length === 0 || /^image\.[a-z0-9]+$/i.test(name.trim());
}

/**
 * The files a paste should attach — possibly none.
 *
 * **Text wins inside a text field.** Copying cells from Excel or a paragraph
 * from Word puts *both* text and a rendered picture of it on the clipboard.
 * Someone pasting that into Kommentarer wants the words; treating it as a file
 * would swallow the text and attach a picture of it instead. A screenshot has
 * no text beside it, so it is attached wherever the cursor happens to be.
 *
 * **Clipboard images get a real name.** See {@link pastedFileName}.
 */
export function filesFromPaste(input: PasteInput, at: Date = new Date()): File[] {
  if (input.files.length === 0) return [];
  if (input.intoEditable && input.text.trim().length > 0) return [];

  const used = new Set<string>();

  return input.files.map((file) => {
    if (!isPlaceholderName(file.name)) return file;

    // Several images in one paste share a timestamp, so they are numbered.
    const base = pastedFileName(file.type, at);
    let name = base;
    for (let counter = 2; used.has(name); counter += 1) {
      name = base.replace(/(\.[^.]+)$/, `-${counter}$1`);
    }
    used.add(name);

    return new File([file], name, { type: file.type, lastModified: at.getTime() });
  });
}

/**
 * Which task a paste belongs to.
 *
 * The row the cursor is in comes first — pasting while typing in a row means
 * *that* task — and the task open in the detail pane is the fallback. With
 * neither there is nowhere to put a file, and the paste is left alone.
 */
export function pasteTargetTaskId(
  focused: Element | null,
  openTaskId: string | null,
): string | null {
  const row = focused?.closest('[data-task-id]');
  const fromRow = row?.getAttribute('data-task-id') ?? null;
  return fromRow !== null && fromRow.length > 0 ? fromRow : openTaskId;
}
