import { useEffect, useRef, useState } from 'react';
import type { StoredFile } from '@taskhub/shared';
import { resolveAttachmentUrl } from '../attachments/attachmentUrls.js';
import { previewKind } from './FilePreview.js';

/**
 * A thumbnail for a row in the files list, fetched only once the row is on
 * screen.
 *
 * Every thumbnail needs its own read grant, and a list of two hundred files
 * would otherwise fire two hundred requests the moment the view opens — two
 * hundred Function invocations to draw a screen that shows fifteen rows. An
 * IntersectionObserver bounds that to what is actually visible, and the shared
 * URL cache means scrolling back up costs nothing.
 *
 * Falls back to the extension badge, which is what every non-image row shows
 * anyway, so a missing or undecodable thumbnail is not a hole in the list.
 */
export function FileThumbnail({ file }: { file: StoredFile }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  const isImage = previewKind(file.contentType, file.fileName) === 'image';

  useEffect(() => {
    if (!isImage) return;
    const element = ref.current;
    if (element === null) return;

    // No IntersectionObserver (older browser, or a test environment) is not a
    // reason to show nothing — just fetch straight away.
    if (typeof IntersectionObserver !== 'function') {
      void resolveAttachmentUrl(file.taskId, file.attachmentId, true).then(setUrl, () => undefined);
      return;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void resolveAttachmentUrl(file.taskId, file.attachmentId, true).then(
          (resolved) => {
            if (!cancelled) setUrl(resolved);
          },
          () => undefined,
        );
      },
      // Start a little before the row arrives, so scrolling does not reveal a
      // column of empty squares that fill in behind the user.
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file.taskId, file.attachmentId, isImage]);

  return (
    <span
      ref={ref}
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-sunken text-[10px] font-medium uppercase text-content-muted"
    >
      {url !== null ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        (file.fileName.split('.').pop()?.slice(0, 4) ?? '?')
      )}
    </span>
  );
}
