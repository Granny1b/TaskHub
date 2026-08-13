import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isImageContentType, type Attachment } from '@taskhub/shared';
import { Button, IconButton } from '../../components/Button.js';
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
  /** True on phones, where nothing can hide behind a hover. */
  touch?: boolean;
}

export function AttachmentGrid({ taskId, attachments, onDelete, touch }: AttachmentGridProps) {
  const { t } = useTranslation();

  /**
   * Deleting a photograph is one tap, and the photograph may be the only record
   * of something that has since been machined, painted or shipped. It gets a
   * confirmation — inline on the tile rather than a modal, so it works the same
   * with a thumb as with a mouse, and it names the file so there is no doubt
   * which tile the tap landed on.
   *
   * Recoverable, but not from here: the API removes the attachment from the
   * document and leaves the blob in place (§5), so nothing is destroyed — there
   * is simply no button that puts it back.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

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

          {/* A touch screen has no hover to reveal the button with, so on a
              phone it simply stays visible. This is the same fix the drag
              grips needed — anything gated on `group-hover` alone does not
              exist on a phone.

              It is unmounted while its own tile is asking for confirmation:
              left in place it stays clickable and tabbable *underneath* the
              overlay, which is two controls named "Ta bort" on one tile. */}
          {confirming === attachment.id ? null : (
            <span
              className={`absolute right-1 top-1 transition-opacity duration-150 ${
                touch === true
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              <IconButton
                label={t('task.delete')}
                className="bg-surface/90"
                touchTarget={touch === true}
                onClick={() => setConfirming(attachment.id)}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          )}

          {confirming === attachment.id ? (
            // Opaque, not translucent: at 95% the filename and the trash icon
            // underneath still show through as ghosted text, which reads as a
            // rendering fault rather than a deliberate overlay.
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface p-2 text-center">
              <p className="text-xs text-content">{t('attachments.confirmDelete')}</p>
              <p className="w-full truncate text-[11px] text-content-muted">
                {attachment.fileName}
              </p>
              {/* Stacked at every width: the tile is two columns on a phone
                  and three on a laptop, so a side-by-side pair wraps its
                  labels ("Ta / bort") in both. */}
              <div className="flex w-full flex-col gap-1.5">
                {/* The danger variant is borderless — right for an inline row
                    action, too quiet for the confirming half of a destructive
                    pair, which has to read as a button next to Avbryt.
                    #dc2626 measures 4.53:1 on the surface, so it can carry the
                    border as well as the text.

                    The border colour is set inline rather than with a class
                    because the variant already sets `border-transparent`, and
                    between two utilities of equal specificity the winner is
                    whichever Tailwind emits later — not whichever is written
                    last in the attribute. Verified in the browser: with a
                    class the computed borderColor stayed rgba(0,0,0,0). */}
                <Button
                  size="sm"
                  variant="danger"
                  style={{ borderColor: 'var(--danger-500)' }}
                  className={`w-full ${touch === true ? 'h-11' : ''}`}
                  onClick={() => {
                    setConfirming(null);
                    onDelete(attachment.id);
                  }}
                >
                  {t('task.delete')}
                </Button>
                {/*
                  Focus lands on Cancel, not on Delete. The button that opened
                  this overlay has just been unmounted, so focus has to be
                  placed somewhere or it falls to the body — and the safe
                  option is the one to put it on when the other is destructive.
                */}
                <Button
                  size="sm"
                  variant="secondary"
                  autoFocus
                  className={`w-full ${touch === true ? 'h-11' : ''}`}
                  onClick={() => setConfirming(null)}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
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
