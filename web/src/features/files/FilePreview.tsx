import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredFile } from '@taskhub/shared';
import { Button, IconButton } from '../../components/Button.js';
import { ChevronRightIcon, CloseIcon, PaperclipIcon } from '../../components/icons.js';
import { useFocusTrap } from '../../lib/useFocusTrap.js';
import { resolveAttachmentUrl } from '../attachments/attachmentUrls.js';
import { formatBytes } from '../attachments/UploadList.js';

/**
 * What the browser can show without help.
 *
 * Images and PDFs render natively; plain text does too. Everything else — a
 * CAD file, a spreadsheet, a saved mail — has no viewer here and would only
 * produce a download prompt inside a modal, which is worse than saying so.
 */
export function previewKind(contentType: string, fileName: string): 'image' | 'pdf' | 'none' {
  const type = contentType.toLowerCase();
  if (type.startsWith('image/')) {
    // HEIC is an image the browser will not decode outside Safari. Offering a
    // preview that renders as a broken icon is worse than not offering one.
    return type.includes('heic') || type.includes('heif') ? 'none' : 'image';
  }
  if (type === 'application/pdf') return 'pdf';

  // Some uploads arrive as octet-stream; fall back to the extension so a PDF
  // does not lose its preview because the browser was vague about the type.
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image';
  return 'none';
}

interface FilePreviewProps {
  files: readonly StoredFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (file: StoredFile) => void;
  onDelete: (file: StoredFile) => void;
}

/**
 * Look at a file without leaving the app.
 *
 * The files view exists so someone can decide what to keep, and that decision
 * cannot be made from a filename. Opening each candidate in a new tab works but
 * loses the list — and losing the list is what makes clearing out fifty photos
 * unbearable. So the preview stays inside the view, and the arrow keys move
 * through the filtered list without closing it.
 */
export function FilePreview({
  files,
  index,
  onIndexChange,
  onClose,
  onDownload,
  onDelete,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const file = files[index];
  useFocusTrap(dialogRef, true, onClose);

  const kind = file === undefined ? 'none' : previewKind(file.contentType, file.fileName);

  useEffect(() => {
    if (file === undefined || kind === 'none') return;

    let cancelled = false;
    setUrl(null);
    setFailed(false);

    void resolveAttachmentUrl(file.taskId, file.attachmentId, false)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [file, kind]);

  // Arrow keys move through the list. Bound on the window rather than the
  // dialog because focus legitimately sits on a button inside it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' && index < files.length - 1) {
        event.preventDefault();
        onIndexChange(index + 1);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onIndexChange(index - 1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, files.length, onIndexChange]);

  if (file === undefined) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label={file.fileName}
    >
      <div ref={dialogRef} className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 bg-surface px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-content">{file.fileName}</span>
            <span className="block truncate text-xs text-content-muted">
              {file.taskTitle ?? t('files.orphan')} · {formatBytes(file.sizeBytes)} ·{' '}
              {file.uploadedAt.slice(0, 10)}
            </span>
          </span>

          <span className="shrink-0 text-xs tabular-nums text-content-muted">
            {index + 1}/{files.length}
          </span>

          <Button size="sm" variant="secondary" onClick={() => onDownload(file)}>
            {t('files.download')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            style={{ borderColor: 'var(--danger-500)' }}
            onClick={() => onDelete(file)}
          >
            {t('task.delete')}
          </Button>
          <IconButton label={t('common.close')} onClick={onClose}>
            <CloseIcon className="h-4 w-4" />
          </IconButton>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
          {index > 0 ? (
            <NavButton
              side="left"
              label={t('files.previous')}
              onClick={() => onIndexChange(index - 1)}
            />
          ) : null}
          {index < files.length - 1 ? (
            <NavButton
              side="right"
              label={t('files.next')}
              onClick={() => onIndexChange(index + 1)}
            />
          ) : null}

          {kind === 'none' ? (
            <NoPreview file={file} onDownload={() => onDownload(file)} />
          ) : failed ? (
            <p className="text-sm text-white">{t('common.error')}</p>
          ) : url === null ? (
            <p className="text-sm text-white">{t('common.loading')}</p>
          ) : kind === 'image' ? (
            <img
              src={url}
              alt={file.fileName}
              className="max-h-full max-w-full object-contain"
              onError={() => setFailed(true)}
            />
          ) : (
            // A PDF renders in the browser's own viewer. The SAS carries no
            // content-disposition, so it displays rather than downloading.
            <iframe src={url} title={file.fileName} className="h-full w-full rounded bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}

function NavButton({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-content shadow-md hover:bg-surface ${
        side === 'left' ? 'left-3' : 'right-3'
      }`}
    >
      <ChevronRightIcon className={`h-5 w-5 ${side === 'left' ? 'rotate-180' : ''}`} />
    </button>
  );
}

/** Honest about what it cannot show, and useful anyway. */
function NoPreview({ file, onDownload }: { file: StoredFile; onDownload: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-surface px-6 py-8 text-center">
      <PaperclipIcon className="h-8 w-8 text-content-muted" />
      <p className="text-sm text-content">{t('files.noPreview')}</p>
      <p className="text-xs uppercase tracking-wide text-content-muted">
        {file.fileName.split('.').pop() ?? ''}
      </p>
      <Button size="sm" variant="primary" onClick={onDownload}>
        {t('files.download')}
      </Button>
    </div>
  );
}
