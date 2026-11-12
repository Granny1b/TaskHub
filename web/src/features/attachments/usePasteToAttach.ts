import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { filesFromPaste, pasteTargetTaskId } from '../../lib/pasteFiles.js';

function isEditable(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Ctrl+V attaches whatever file is on the clipboard to the task being worked on.
 *
 * Snip a region, press Ctrl+V, and the screenshot is on the task — no saving it
 * somewhere first, no file dialogue. One listener for the whole app, so it does
 * not matter where the cursor is: in a row's title, in Kommentarer, in the
 * detail pane, or nowhere in particular.
 *
 * Which task is decided by `pasteTargetTaskId`: the row the cursor is in, else
 * the task open in the pane. When the paste goes to a task whose pane is not
 * open, the pane opens, so the upload is seen to happen rather than taken on
 * trust.
 *
 * The upload pipeline is imported on first use. It is the heaviest thing the
 * detail pane brings with it, and the list should not pay for it at first paint
 * on the chance that someone pastes.
 */
export function usePasteToAttach(
  openTaskId: string | null,
  onOpenTask: (taskId: string) => void,
): void {
  const client = useQueryClient();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData;
      if (data === null) return;

      const focused = document.activeElement;
      const files = filesFromPaste({
        files: Array.from(data.files),
        text: data.getData('text/plain'),
        intoEditable: isEditable(focused),
      });
      if (files.length === 0) return;

      const taskId = pasteTargetTaskId(focused, openTaskId);
      if (taskId === null) return;

      // Only now: a paste we are not going to use must behave as it always did.
      event.preventDefault();

      void import('./useUploads.js').then(({ startUploads }) => {
        startUploads(client, taskId, files);
      });
      if (taskId !== openTaskId) onOpenTask(taskId);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [client, openTaskId, onOpenTask]);
}
