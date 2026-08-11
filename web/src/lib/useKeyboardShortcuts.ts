import { useEffect } from 'react';

export interface Shortcuts {
  onSearch?: () => void;
  onNewTask?: () => void;
  onEscape?: () => void;
}

/**
 * Global keyboard shortcuts: `/` focuses search, `n` creates a task, `Esc`
 * closes the detail pane.
 *
 * The guard below matters more than the shortcuts do. Almost every cell in this
 * app becomes an input on click, so firing `n` while someone is typing a task
 * title would be a constant, baffling interruption. Anything originating in an
 * editable element is ignored outright — except Escape, which must always work,
 * since it is how you get out of the thing you are typing in.
 */
export function useKeyboardShortcuts({ onSearch, onNewTask, onEscape }: Shortcuts): void {
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        onSearch?.();
      } else if (event.key === 'n') {
        event.preventDefault();
        onNewTask?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSearch, onNewTask, onEscape]);
}
