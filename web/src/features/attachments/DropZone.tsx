import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  /** Also accept files pasted from the clipboard while this zone is mounted. */
  acceptPaste?: boolean;
  disabled?: boolean;
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
        handleFiles(event.dataTransfer?.files);
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
