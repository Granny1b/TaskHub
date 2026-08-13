import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isImageContentType, type StoredFile } from '@taskhub/shared';
import { Button, IconButton } from '../../components/Button.js';
import { EmptyState } from '../../components/EmptyState.js';
import { PaperclipIcon, SearchIcon, TrashIcon } from '../../components/icons.js';
import { Skeleton } from '../../components/Skeleton.js';
import { api } from '../../lib/apiClient.js';
import { useDeleteFile, useFiles } from '../../lib/queries.js';
import { forgetAttachmentUrls } from '../attachments/attachmentUrls.js';
import { formatBytes } from '../attachments/UploadList.js';
import { FilePreview } from './FilePreview.js';
import { FileThumbnail } from './FileThumbnail.js';

/**
 * Everything stored, in one list.
 *
 * The question this answers is not "what is attached to this task" — the detail
 * pane already does that. It is "what am I keeping, and what can go": storage
 * at rest is the largest line in docs/COSTS.md, and until now nothing in the app
 * could show it.
 *
 * Built on the blob listing rather than on task documents (ADR-0043), which is
 * why it can show files whose task has been deleted. Those are exactly the ones
 * worth deleting, so hiding them would defeat the purpose.
 */

type Kind = 'all' | 'image' | 'document' | 'other';

/**
 * Grouping by what someone would call the file, not by MIME type.
 *
 * "Bilder" is a category people have; `image/heic` is not. Anything unrecognised
 * lands in "Övrigt" rather than being hidden.
 */
function kindOf(file: StoredFile): Exclude<Kind, 'all'> {
  if (isImageContentType(file.contentType) || file.contentType.startsWith('image/')) return 'image';

  const documentTypes = ['pdf', 'word', 'excel', 'powerpoint', 'text', 'csv', 'officedocument'];
  if (documentTypes.some((token) => file.contentType.includes(token))) return 'document';

  const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];
  const extension = file.fileName.split('.').pop()?.toLowerCase() ?? '';
  return documentExtensions.includes(extension) ? 'document' : 'other';
}

/** Search covers filename and task title: both are things people remember. */
export function matchesSearch(file: StoredFile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    file.fileName.toLowerCase().includes(needle) ||
    (file.taskTitle ?? '').toLowerCase().includes(needle)
  );
}

export function totalBytes(files: readonly StoredFile[]): number {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

interface FilesViewProps {
  compact: boolean;
  onOpenTask: (taskId: string) => void;
}

export function FilesView({ compact, onOpenTask }: FilesViewProps) {
  const { t } = useTranslation();
  const files = useFiles();
  const deleteFile = useDeleteFile();

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Index into `shown`, so the arrows walk the list the user is looking at. */
  const [previewAt, setPreviewAt] = useState<number | null>(null);

  const all = useMemo(() => files.data ?? [], [files.data]);
  const shown = useMemo(
    () =>
      all.filter(
        (file) => matchesSearch(file, search) && (kind === 'all' || kindOf(file) === kind),
      ),
    [all, search, kind],
  );

  const download = async (file: StoredFile): Promise<void> => {
    setError(null);
    try {
      const grant = await api.getAttachmentDownloadUrl(file.taskId, file.attachmentId);
      window.open(grant.url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
    }
  };

  const remove = (file: StoredFile): void => {
    setError(null);
    setConfirming(null);
    deleteFile.mutate(
      { taskId: file.taskId, attachmentId: file.attachmentId },
      {
        onSuccess: () => {
          // The bytes are gone, so a cached URL for them now resolves to a 404.
          forgetAttachmentUrls(file.taskId, file.attachmentId);
          setPreviewAt(null);
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : t('common.error')),
      },
    );
  };

  if (files.isLoading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-5/6" />
        <Skeleton className="h-8 w-4/6" />
      </div>
    );
  }

  if (files.isError) {
    return (
      <EmptyState
        title={t('common.error')}
        description={(files.error as Error).message}
        action={
          <Button variant="secondary" onClick={() => void files.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border-subtle px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <SearchIcon className="pointer-events-none absolute left-2 h-4 w-4 text-content-muted" />
            <input
              type="search"
              value={search}
              placeholder={t('files.search')}
              aria-label={t('files.search')}
              onChange={(event) => setSearch(event.target.value)}
              className={`w-full rounded-md border border-border-subtle bg-surface pl-7 pr-2 text-sm text-content outline-none focus:border-accent ${
                compact ? 'h-11' : 'h-8'
              }`}
            />
          </div>

          <div className="flex gap-1" role="group" aria-label={t('files.filterByType')}>
            {(['all', 'image', 'document', 'other'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors duration-150 ${
                  compact ? 'h-11' : ''
                } ${
                  kind === option
                    ? 'border-accent bg-surface-selected font-medium text-content'
                    : 'border-border-subtle text-content-muted hover:bg-surface-hover'
                }`}
              >
                {t(`files.kind.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {/* The number people are actually here for. */}
        <p className="mt-1.5 text-xs tabular-nums text-content-muted">
          {t('files.summary', { count: shown.length, size: formatBytes(totalBytes(shown)) })}
          {shown.length !== all.length ? ` · ${t('files.ofTotal', { count: all.length })}` : ''}
        </p>

        {error !== null ? (
          <p className="mt-1 text-xs text-[var(--danger-500)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto">
        {shown.length === 0 ? (
          <EmptyState
            icon={<PaperclipIcon className="h-8 w-8" />}
            title={all.length === 0 ? t('files.empty') : t('files.noMatches')}
          />
        ) : (
          <ul>
            {shown.map((file) => (
              <li
                key={file.blobPath}
                className="group flex items-center gap-3 border-b border-border-subtle px-3 py-2 hover:bg-surface-hover"
              >
                <FileThumbnail file={file} />

                <span className="min-w-0 flex-1">
                  {/* The filename opens the file. Clicking what you are looking
                      at is the obvious gesture, and it saves a separate
                      "preview" control competing with download and delete. */}
                  <button
                    type="button"
                    onClick={() => setPreviewAt(shown.indexOf(file))}
                    className="block max-w-full truncate text-left text-sm text-content underline-offset-2 hover:underline"
                    title={file.fileName}
                  >
                    {file.fileName}
                  </button>
                  <span className="block truncate text-xs text-content-muted">
                    {file.taskTitle !== null ? (
                      <button
                        type="button"
                        onClick={() => onOpenTask(file.taskId)}
                        className="underline-offset-2 hover:text-content hover:underline"
                      >
                        {file.taskTitle}
                      </button>
                    ) : (
                      // No task claims these bytes. Named plainly, because they
                      // are the ones with nothing left to lose by deleting.
                      <span className="italic">{t('files.orphan')}</span>
                    )}
                  </span>
                </span>

                <span className="shrink-0 text-xs tabular-nums text-content-muted">
                  {formatBytes(file.sizeBytes)}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-content-muted sm:block">
                  {file.uploadedAt.slice(0, 10)}
                </span>

                {confirming === file.blobPath ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs text-content">{t('files.confirmDelete')}</span>
                    <Button
                      size="sm"
                      variant="danger"
                      style={{ borderColor: 'var(--danger-500)' }}
                      onClick={() => remove(file)}
                    >
                      {t('task.delete')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      autoFocus
                      onClick={() => setConfirming(null)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </span>
                ) : (
                  <span
                    className={`flex shrink-0 items-center gap-0.5 transition-opacity duration-150 ${
                      compact ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                    }`}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void download(file)}
                      className={compact ? 'h-11' : ''}
                    >
                      {t('files.download')}
                    </Button>
                    <IconButton
                      label={t('task.delete')}
                      touchTarget={compact}
                      onClick={() => setConfirming(file.blobPath)}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {previewAt !== null && shown[previewAt] !== undefined ? (
        <FilePreview
          files={shown}
          index={previewAt}
          onIndexChange={setPreviewAt}
          onClose={() => setPreviewAt(null)}
          onDownload={(file) => void download(file)}
          onDelete={(file) => remove(file)}
        />
      ) : null}
    </div>
  );
}

export { kindOf };
