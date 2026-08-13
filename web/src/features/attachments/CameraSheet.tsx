import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components/Button.js';
import { CloseIcon } from '../../components/icons.js';

/**
 * A camera that never leaves the page.
 *
 * The file-input route — `capture`, or picking Camera from the OS chooser —
 * hands control to the camera app and asks for it back. On the phones this app
 * runs on, that round trip never completed: the photograph was taken, and the
 * page died on the way back with the system reporting too little memory. Three
 * separate fixes to what happened *after* the file arrived changed nothing,
 * which is the strongest evidence there is that the problem is the handoff
 * itself.
 *
 * `getUserMedia` removes the handoff. No second app starts, the page stays in
 * the foreground the whole time, and the photograph is produced inside the page
 * that wants it. Nothing can be evicted in between because there is no
 * in-between.
 *
 * The trade is resolution: a frame from the video stream is smaller than what
 * the camera app would save. That costs nothing here — every photograph is
 * scaled to 2560px on upload anyway (ADR-0040), so the stream is asked for
 * roughly that and the result is the same picture that would have survived
 * compression, without ever building the enormous one first.
 */

/** Matches the compression target, so nothing is captured only to be thrown away. */
const IDEAL_EDGE = 2560;

interface CameraSheetProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Used when the browser has no camera to offer, so the user is not stuck. */
  onFallback: () => void;
}

type Status = 'starting' | 'live' | 'denied' | 'unavailable';

/**
 * Constraint sets, tried in order until one opens.
 *
 * The first asks for the rear camera at roughly the size the upload wants. The
 * later ones give that up piece by piece, because a phone that refuses a
 * specific request will often satisfy a vague one — and a working camera at the
 * wrong resolution beats a correct request that never opens. The last is the
 * least a browser can be asked for.
 */
const ATTEMPTS: readonly MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: IDEAL_EDGE },
      height: { ideal: IDEAL_EDGE },
    },
    audio: false,
  },
  { video: { facingMode: { ideal: 'environment' } }, audio: false },
  { video: true, audio: false },
];

export function CameraSheet({ onCapture, onClose, onFallback }: CameraSheetProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Release the camera.
   *
   * Not optional housekeeping: a track left running keeps the phone's camera
   * indicator lit and the sensor powered, which looks like the app spying long
   * after the user has moved on.
   */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      if (navigator.mediaDevices?.getUserMedia === undefined) {
        setStatus('unavailable');
        return;
      }

      let stream: MediaStream | null = null;
      let lastError: unknown = null;

      for (const constraints of ATTEMPTS) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
          // A refusal is a decision, not a bad request: retrying with weaker
          // constraints cannot change the answer and only delays the message.
          if (error instanceof Error && error.name === 'NotAllowedError') break;
        }
      }

      if (cancelled) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }

      if (stream === null) {
        const name = lastError instanceof Error ? lastError.name : '';
        // Kept and shown: the browser's own name for the failure is the only
        // thing that distinguishes a blocked camera from a busy one, and it is
        // what makes a report from a phone actionable from here.
        setFailure(name.length > 0 ? name : 'UnknownError');
        setStatus(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        );
        return;
      }

      streamRef.current = stream;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus('live');
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  const capture = (): void => {
    const video = videoRef.current;
    if (video === null) return;

    // The stream's own dimensions, so the frame is captured at whatever the
    // camera actually delivered rather than at the size it is displayed.
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (context === null) return;
    context.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob === null) return;
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        onCapture(new File([blob], `foto-${stamp}.jpg`, { type: 'image/jpeg' }));
        stop();
        onClose();
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={t('attachments.camera')}
    >
      <header className="flex shrink-0 items-center justify-between bg-surface px-3 py-2">
        <span className="text-sm font-medium text-content">{t('attachments.camera')}</span>
        <IconButton label={t('common.close')} touchTarget onClick={onClose}>
          <CloseIcon className="h-5 w-5" />
        </IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-contain ${status === 'live' ? '' : 'invisible'}`}
        />

        {status === 'starting' ? (
          <p className="absolute text-sm text-white">{t('common.loading')}</p>
        ) : null}

        {status === 'denied' || status === 'unavailable' ? (
          <div className="absolute flex max-w-xs flex-col items-center gap-3 rounded-lg bg-surface p-4 text-center">
            <p className="text-sm text-content">
              {status === 'denied' ? t('attachments.cameraDenied') : t('attachments.cameraMissing')}
            </p>
            {failure !== null ? (
              <p className="font-mono text-[11px] text-content-muted">{failure}</p>
            ) : null}
            <Button
              variant="primary"
              onClick={() => {
                stop();
                onFallback();
              }}
            >
              {t('attachments.add')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Shutter. Deliberately large and central: this is used one-handed, on a
          shop floor, often wearing gloves. */}
      <div className="shrink-0 bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={status !== 'live'}
          onClick={capture}
          aria-label={t('attachments.takePhoto')}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-border-strong bg-surface-raised disabled:opacity-40"
        >
          <span aria-hidden className="h-12 w-12 rounded-full bg-accent" />
        </button>
      </div>
    </div>
  );
}
