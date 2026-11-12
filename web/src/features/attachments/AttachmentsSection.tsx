import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ALLOWED_EXTENSIONS, type Attachment } from '@taskhub/shared';
import { Button } from '../../components/Button.js';
import { PaperclipIcon, PlusIcon } from '../../components/icons.js';
import { api } from '../../lib/apiClient.js';
import { queryKeys } from '../../lib/queries.js';
import { AttachmentGrid } from './AttachmentGrid.js';
import { CameraSheet } from './CameraSheet.js';
import { DropZone } from './DropZone.js';
import { MAX_UPLOAD_LABEL, UploadList } from './UploadList.js';
import { useUploads } from './useUploads.js';

/**
 * What the file picker offers, and what it deliberately does not.
 *
 * The extensions come from the same allowlist the server enforces, so the
 * dialogue cannot drift from what will actually be accepted — being told "not
 * allowed" *after* choosing a file is a poor way to find out.
 *
 * `image/*` is the interesting part. It is what makes Android put **Camera** in
 * the chooser, and that entry is the one path still known to fail: choosing it
 * hands control to the camera app, and on the phone this was tested on the tab
 * does not survive the round trip — the photograph is taken and lost.
 *
 * So on a phone it is left out, and the camera is reached through the button
 * beside this one, which never leaves the page and is confirmed working
 * (ADR-0045). Photographs remain pickable here through the ordinary document
 * picker. On a desktop there is no camera intent to walk into, and `image/*`
 * makes the dialogue tidier, so it stays.
 */
function acceptFor(compact: boolean): string {
  const extensions = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`);
  return (compact ? extensions : ['image/*', ...extensions]).join(',');
}

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
 * the part on the shop floor. Paste is the one not wired up here: it is caught
 * at the shell so it works before this panel exists (`usePasteToAttach`).
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
  const section = useRef<HTMLElement>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  /**
   * Shown when a drop carried nothing the browser will hand over — in practice,
   * a mail dragged out of Outlook. It is not an error in this app, so it is
   * phrased as what to do instead rather than as a failure.
   */
  const [dropHint, setDropHint] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  /*
    Bring a new upload into view.

    A paste can start an upload while this section is scrolled out of sight
    below the task's fields, and then nothing visibly happens. `nearest` means
    it does not move at all when the section is already on screen.
  */
  const uploadCount = uploads.length;
  const seenUploads = useRef(0);
  useEffect(() => {
    if (uploadCount > seenUploads.current) {
      section.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    seenUploads.current = uploadCount;
  }, [uploadCount]);

  /**
   * Take what a picker handed back, and say so when it handed back nothing.
   *
   * `upload([])` does nothing at all, which is indistinguishable from the app
   * ignoring the tap — and a camera that returns no file is exactly the case
   * that produced "nothing happens when I take a photo".
   */
  const handleChosen = (files: FileList | null): void => {
    setDropHint(false);
    setRemoveError(null);

    const chosen = files === null ? [] : Array.from(files);
    if (chosen.length === 0) {
      setRemoveError(t('attachments.nothingSelected'));
      return;
    }
    upload(chosen);
  };

  const remove = async (attachmentId: string): Promise<void> => {
    setRemoveError(null);
    try {
      const saved = await api.deleteAttachment(taskId, attachmentId, etag);
      client.setQueryData(queryKeys.task(taskId), { data: saved.data, etag: saved.etag });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    } catch (cause) {
      // Silently swallowing this leaves the photo on screen with no explanation
      // — indistinguishable from a delete that did not register. The usual
      // cause is a stale ETag, so refetch: the next attempt then has a current
      // version to write against rather than being permanently stuck.
      setRemoveError(cause instanceof Error ? cause.message : t('common.error'));
      void client.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    }
  };

  return (
    <section ref={section} className="mt-6">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-muted">
        {t('columns.attachments')}
        {attachments.length > 0 ? (
          <span className="ml-2 tabular-nums">{attachments.length}</span>
        ) : null}
      </h2>

      <UploadList uploads={uploads} onCancel={cancel} onDismiss={dismiss} />

      {removeError !== null ? (
        <p className="mb-2 text-xs text-[var(--danger-500)]" role="alert">
          {removeError}
        </p>
      ) : null}

      {dropHint ? (
        <p className="mb-2 text-xs text-content-muted" role="status">
          {t('attachments.noFilesInDrop')}
        </p>
      ) : null}

      {cameraOpen ? (
        <CameraSheet
          onCapture={(file) => upload([file])}
          onClose={() => setCameraOpen(false)}
          onFallback={() => {
            // No camera to offer. Send them to the picker that works rather
            // than leaving them looking at an apology.
            setCameraOpen(false);
            fileInput.current?.click();
          }}
        />
      ) : null}

      <DropZone
        onFiles={(files) => {
          setDropHint(false);
          upload(files);
        }}
        onNothingUsable={() => setDropHint(true)}
      >
        {attachments.length > 0 ? (
          <AttachmentGrid
            taskId={taskId}
            attachments={attachments}
            touch={compact}
            onDelete={(id) => void remove(id)}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border-strong px-3 py-6 text-center">
            <PaperclipIcon className="mx-auto h-5 w-5 text-content-muted" />
            <p className="mt-2 text-sm text-content-muted">
              {compact ? t('attachments.drop') : t('attachments.dropOrPaste')}
            </p>
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
              onClick={() => setCameraOpen(true)}
            >
              {t('attachments.camera')}
            </Button>
          ) : null}
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          accept={acceptFor(compact)}
          className="hidden"
          onChange={(event) => {
            handleChosen(event.target.files);
            // Reset, so selecting the same file twice in a row still fires.
            event.target.value = '';
          }}
        />
      </DropZone>
    </section>
  );
}
