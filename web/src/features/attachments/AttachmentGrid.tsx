import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isImageContentType, type Attachment } from '@taskhub/shared';
import { IconButton } from '../../components/Button.js';
import { PaperclipIcon, TrashIcon } from '../../components/icons.js';
import { api } from '../../lib/apiClient.js';
import { formatBytes } from './UploadList.js';

/**
 * Read URLs are short-lived (15 minutes) and fetched on demand, so the cache is
 * process-local and expiry-aware. Containers are never public; every view of an
 * attachment goes through a fresh grant.
 *
 * A module-level Map rather than React state because these are shared across
 * every grid and thumbnail on the page, and re-fetching a URL per component
 * would multiply the requests for no benefit.
 */
const urlCache = new Map<string, { url: string; expiresAt: number }>();

/** Refresh a minute early rather than serving a URL that expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

async function resolveUrl(
  taskId: string,
  attachmentId: string,
  thumbnail: boolean,
): Promise<string> {
  const key = `${taskId}/${attachmentId}/${thumbnail ? 'thumb' : 'full'}`;
  const cached = urlCache.get(key);
  if (cached !== undefined && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.url;
  }

  const grant = await api.getAttachmentUrl(taskId, attachmentId, { thumbnail });
  urlCache.set(key, { url: grant.url, expiresAt: Date.parse(grant.expiresOn) });
  return grant.url;
}

interface AttachmentGridProps {
  taskId: string;
  attachments: readonly Attachment[];
  onDelete: (attachmentId: string) => void;
}

export function AttachmentGrid({ taskId, attachments, onDelete }: AttachmentGridProps) {
  const { t } = useTranslation();
  if (attachments.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="group relative overflow-hidden rounded-md border border-border-subtle bg-surface-raised"
        >
          <AttachmentPreview taskId={taskId} attachment={attachment} />

          <div className="px-2 py-1.5">
            <p className="truncate text-xs text-content" title={attachment.fileName}>
              {attachment.fileName}
            </p>
            <p className="text-[11px] tabular-nums text-content-muted">
              {formatBytes(attachment.sizeBytes)}
            </p>
          </div>

          <span className="absolute right-1 top-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <IconButton
              label={t('task.delete')}
              className="bg-surface/90"
              onClick={() => onDelete(attachment.id)}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AttachmentPreview({ taskId, attachment }: { taskId: string; attachment: Attachment }) {
  const { t } = useTranslation();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const hasThumbnail =
    attachment.thumbnailPath !== null && isImageContentType(attachment.contentType);

  useEffect(() => {
    if (!hasThumbnail) return;
    let cancelled = false;

    void resolveUrl(taskId, attachment.id, true)
      .then((url) => {
        if (!cancelled) setThumbUrl(url);
      })
      .catch(() => {
        // A thumbnail that will not load is not worth an error state; the tile
        // falls back to the file-type placeholder below.
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, attachment.id, hasThumbnail]);

  const open = async (): Promise<void> => {
    const url = await resolveUrl(taskId, attachment.id, false);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      className="block aspect-4/3 w-full bg-surface-sunken"
      aria-label={attachment.fileName}
    >
      {thumbUrl !== null ? (
        <img
          src={thumbUrl}
          alt={attachment.fileName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-content-muted">
          <PaperclipIcon className="h-5 w-5" />
          <span className="text-[10px] uppercase tracking-wide">
            {attachment.fileName.split('.').pop() ?? t('columns.attachments')}
          </span>
        </span>
      )}
    </button>
  );
}
