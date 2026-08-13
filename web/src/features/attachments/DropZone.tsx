import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  /** Also accept files pasted from the clipboard while this zone is mounted. */
  acceptPaste?: boolean;
  disabled?: boolean;
  /**
   * Something was dropped, but no file came with it.
   *
   * Almost always an Outlook mail — see `classifyDrop`. Without this the drop
   * is swallowed in silence, which is indistinguishable from the app being
   * broken.
   */
  onNothingUsable?: () => void;
}

export type DropOutcome =
  | { readonly kind: 'files'; readonly files: File[] }
  /** A drop happened and carried no file the browser will give us. */
  | { readonly kind: 'nothing-usable' }
  /** Nothing was dropped at all — not worth telling anyone about. */
  | { readonly kind: 'empty' };

/**
 * Work out what a drop actually delivered.
 *
 * The case this exists for is dragging a mail out of Outlook, which does not
 * work and cannot be made to work from here. An Outlook mail is not a file on
 * disk — it lives in the OST or on the Exchange server — so Outlook offers the
 * drag as OLE `FileGroupDescriptor`/`FileContents` rather than as a file path.
 * Browsers populate `DataTransfer.files` only from real filesystem drops, so
 * `files` arrives empty and there is nothing to upload.
 *
 * Nothing in this app can change that; it is decided between Outlook and the
 * browser before any of our code runs. What we *can* do is stop pretending the
 * drop never happened, and say what to do instead (save the mail, drop the
 * file).
 *
 * `types` distinguishes "dropped a mail" from "brushed past with the cursor":
 * a real drop announces something, an empty event announces nothing.
 */
export function classifyDrop(transfer: DataTransfer | null | undefined): DropOutcome {
  if (transfer === null || transfer === undefined) return { kind: 'empty' };

  const files = Array.from(transfer.files ?? []);
  if (files.length > 0) return { kind: 'files', files };

  const announced = Array.from(transfer.types ?? []);
  return announced.length > 0 ? { kind: 'nothing-usable' } : { kind: 'empty' };
}

/**
 * A drop target that also accepts pasted files.
 *
 * Paste matters more than it looks: taking a screenshot and pressing Ctrl+V is
 * the fastest way to attach evidence to a quality record, and it is the flow
 * people actually use when the alternative is save-to-disk-then-browse.
 *
 * Drag state is counted rather than toggled. `dragenter`/`dragleave` fire for
 * every descendant the pointer crosses, so a boolean flickers off the moment
 * the cursor moves over a child element.
 */
export function DropZone({
  onFiles,
  children,
  className = '',
  acceptPaste,
  disabled,
  onNothingUsable,
}: DropZoneProps) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const handleFiles = useCallback(
    (list: FileList | null | undefined) => {
      if (disabled === true || list === null || list === undefined) return;
      const files = Array.from(list);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled],
  );

  useEffect(() => {
    if (acceptPaste !== true || disabled === true) return;

    const onPaste = (event: ClipboardEvent): void => {
      const items = event.clipboardData?.files;
      if (items !== undefined && items.length > 0) {
        event.preventDefault();
        handleFiles(items);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptPaste, disabled, handleFiles]);

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        setIsOver(true);
      }}
      onDragOver={(event) => {
        // Without this the browser navigates away to the dropped file, which
        // loses whatever the user was doing.
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setIsOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setIsOver(false);
        if (disabled === true) return;

        const outcome = classifyDrop(event.dataTransfer);
        if (outcome.kind === 'files') onFiles(outcome.files);
        else if (outcome.kind === 'nothing-usable') onNothingUsable?.();
      }}
    >
      {children}

      {isOver && disabled !== true ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-md border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
        />
      ) : null}
    </div>
  );
}

/**
 * Swallow drops that miss a drop zone.
 *
 * The browser's default is to navigate to the dropped file, discarding
 * application state. Someone who misses the panel by twenty pixels should get
 * nothing, not lose their place.
 */
export function useWindowDropGuard(): void {
  useEffect(() => {
    const prevent = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault();
    };

    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);
}
