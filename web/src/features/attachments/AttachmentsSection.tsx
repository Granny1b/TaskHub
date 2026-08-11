import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { Attachment } from '@taskhub/shared';
import { Button } from '../../components/Button.js';
import { PaperclipIcon, PlusIcon } from '../../components/icons.js';
import { api } from '../../lib/apiClient.js';
import { queryKeys } from '../../lib/queries.js';
import { AttachmentGrid } from './AttachmentGrid.js';
import { DropZone } from './DropZone.js';
import { MAX_UPLOAD_LABEL, UploadList } from './UploadList.js';
import { useUploads } from './useUploads.js';

interface AttachmentsSectionProps {
  taskId: string;
  attachments: readonly Attachment[];
  etag: string;
  /** True on phones: camera capture and larger targets. */
  compact: boolean;
}

/**
 * The attachments panel: drop zone, in-flight uploads, and the grid.
 *
 * Three ways in, because the useful one differs by context — drag a file from
 * Explorer at a desk, paste a screenshot while writing up a fault, photograph
 * the part on the shop floor.
 */
export function AttachmentsSection({
  taskId,
  attachments,
  etag,
  compact,
}: AttachmentsSectionProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { uploads, upload, cancel, dismiss } = useUploads(taskId);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const remove = async (attachmentId: string): Promise<void> => {
    const saved = await api.deleteAttachment(taskId, attachmentId, etag);
    client.setQueryData(queryKeys.task(taskId), { data: saved.data, etag: saved.etag });
    void client.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
        {t('columns.attachments')}
        {attachments.length > 0 ? (
          <span className="ml-2 tabular-nums">{attachments.length}</span>
        ) : null}
      </h2>

      <UploadList uploads={uploads} onCancel={cancel} onDismiss={dismiss} />

      {/* The whole section is a drop target, and accepts pasted screenshots. */}
      <DropZone onFiles={(files) => upload(files)} acceptPaste>
        {attachments.length > 0 ? (
          <AttachmentGrid
            taskId={taskId}
            attachments={attachments}
            onDelete={(id) => void remove(id)}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center">
            <PaperclipIcon className="mx-auto h-5 w-5 text-content-muted" />
            <p className="mt-2 text-sm text-content-muted">{t('attachments.drop')}</p>
            <p className="mt-0.5 text-xs text-content-muted">max {MAX_UPLOAD_LABEL}</p>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            className={compact ? 'h-11 flex-1' : ''}
            onClick={() => fileInput.current?.click()}
          >
            <PlusIcon className="h-4 w-4" />
            {t('attachments.add')}
          </Button>

          {/* Shop-floor photo capture is a real use case, so the camera gets a
              button of its own rather than hiding behind the file picker. */}
          {compact ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-11 flex-1"
              onClick={() => cameraInput.current?.click()}
            >
              {t('attachments.camera')}
            </Button>
          ) : null}
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            if (files !== null) upload(Array.from(files));
            // Reset, so selecting the same file twice in a row still fires.
            event.target.value = '';
          }}
        />

        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            if (files !== null) upload(Array.from(files));
            event.target.value = '';
          }}
        />
      </DropZone>
    </section>
  );
}
