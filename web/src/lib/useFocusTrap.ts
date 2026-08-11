import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap focus inside a modal surface — the mobile drawer and the percent sheet.
 *
 * Without this, tabbing out of an overlay lands on the page behind it, which a
 * sighted mouse user never notices and a keyboard or screen-reader user cannot
 * recover from: focus is somewhere they cannot see, on controls the overlay is
 * covering.
 *
 * It also restores focus to whatever opened the overlay on close, so dismissing
 * a drawer returns you to the hamburger rather than the top of the document.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );

    // Move focus in, so the first Tab goes somewhere sensible rather than
    // continuing from wherever it was on the page behind.
    const first = focusable()[0];
    if (first !== undefined) first.focus();
    else container.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = elements[0] as HTMLElement;
      const lastElement = elements[elements.length - 1] as HTMLElement;
      const current = document.activeElement;

      if (event.shiftKey && (current === firstElement || !container.contains(current))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && current === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, active, onEscape]);
}
