import { useTranslation } from 'react-i18next';
import { ATTACHMENT_MAX_BYTES } from '@taskhub/shared';
import { IconButton } from '../../components/Button.js';
import { CloseIcon } from '../../components/icons.js';
import type { UploadItem } from './useUploads.js';

interface UploadListProps {
  uploads: readonly UploadItem[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * In-flight uploads.
 *
 * Shows real progress rather than an indeterminate spinner, because a 20 MB PDF
 * over a workshop wifi connection takes long enough that "is this working?" is
 * a fair question. Cancel is always available while an upload is running.
 */
export function UploadList({ uploads, onCancel, onDismiss }: UploadListProps) {
  const { t } = useTranslation();
  if (uploads.length === 0) return null;

  return (
    <ul className="mb-3 space-y-1.5">
      {uploads.map((upload) => {
        const failed = upload.status === 'error';
        const cancelled = upload.status === 'cancelled';
        const finished = upload.status === 'done';
        const running =
          upload.status === 'uploading' ||
          upload.status === 'validating' ||
          upload.status === 'preparing';
        const shrunk = upload.originalBytes !== undefined;

        return (
          <li
            key={upload.id}
            className="rounded-md border border-border-subtle bg-surface-raised px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-content">
                {upload.fileName}
              </span>
              {/* When a photo has been shrunk, both numbers are shown. The
                  app rewrote someone's file; saying so is the least it owes
                  them, and it makes the setting discoverable at the moment it
                  is relevant. */}
              <span className="shrink-0 text-xs tabular-nums text-content-muted">
                {shrunk ? (
                  <>
                    <span className="line-through">
                      {formatBytes(upload.originalBytes ?? 0)}
                    </span>{' '}
                  </>
                ) : null}
                {formatBytes(upload.sizeBytes)}
              </span>

              {running ? (
                <IconButton label={t('attachments.cancel')} onClick={() => onCancel(upload.id)}>
                  <CloseIcon className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}

              {failed || cancelled ? (
                <IconButton label={t('common.close')} onClick={() => onDismiss(upload.id)}>
                  <CloseIcon className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
            </div>

            {failed ? (
              <p className="mt-1 text-xs text-[var(--danger-500)]">
                {upload.error ?? t('common.error')}
              </p>
            ) : (
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  role="progressbar"
                  aria-valuenow={upload.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={upload.fileName}
                  className="relative h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                >
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ${
                      finished ? 'bg-[var(--success-500)]' : 'bg-accent'
                    }`}
                    style={{ width: `${cancelled ? 0 : upload.percent}%` }}
                  />
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-content-muted">
                  {cancelled
                    ? t('attachments.cancel')
                    : upload.status === 'preparing'
                      ? t('attachments.compressing')
                      : upload.status === 'committing'
                        ? t('common.loading')
                        : `${upload.percent}%`}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const MAX_UPLOAD_LABEL = `${Math.floor(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`;
