import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { LIST_COLORS, listColorVar } from './listColors.js';

interface ListColorPickerProps {
  listName: string;
  colorToken: string | null;
  onPick: (colorToken: string | null) => void;
}

/**
 * A swatch that opens a small palette.
 *
 * Deliberately not a `<select>`: the choice is entirely visual, and a dropdown
 * reading "blue, green, teal" is a worse version of seven circles. The names
 * still reach screen readers as each swatch's label, which is what makes the
 * control usable without seeing it.
 *
 * The palette is portalled to the body rather than positioned inside the row,
 * for two reasons that both make it unusable otherwise: the side panel is an
 * `overflow-y-auto` container and would clip it, and the row's action cluster
 * is opacity-gated on hover — so moving the pointer down onto the palette
 * hides the very thing being clicked.
 */
export function ListColorPicker({ listName, colorToken, onPick }: ListColorPickerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const open = anchor !== null;

  useEffect(() => {
    if (!open) return undefined;

    const close = (): void => setAnchor(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) === true) return;
      if (buttonRef.current?.contains(target) === true) return;
      close();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    // Fixed coordinates go stale the moment anything moves underneath.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (): void => {
    if (open) {
      setAnchor(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    // Below the swatch, nudged left so a 7-colour row clears the panel edge.
    setAnchor({ top: rect.bottom + 6, left: Math.max(8, rect.right - 232) });
  };

  const choose = (next: string | null): void => {
    setAnchor(null);
    if (next !== colorToken) onPick(next);
  };

  const current = listColorVar(colorToken);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('lists.color', { name: listName })}
        onClick={toggle}
        className="flex h-7 w-7 items-center justify-center rounded-md text-content-muted transition-colors duration-150 hover:bg-surface-hover hover:text-content"
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-border-control"
          style={current !== null ? { backgroundColor: current, borderColor: current } : undefined}
        />
      </button>

      {anchor !== null
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              aria-label={t('lists.color', { name: listName })}
              style={{ position: 'fixed', top: anchor.top, left: anchor.left }}
              className="z-50 flex gap-1 rounded-md border border-border-subtle bg-surface p-1.5 shadow-lg"
            >
              {/* "No colour" first: it is the default, and the way back. */}
              <button
                type="button"
                role="menuitem"
                aria-label={t('lists.colorNone')}
                onClick={() => choose(null)}
                className={`flex h-6 w-6 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-110 ${
                  colorToken === null ? 'border-accent' : 'border-border-control'
                }`}
              >
                <span aria-hidden className="text-[11px] leading-none text-content-muted">
                  ×
                </span>
              </button>

              {LIST_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="menuitem"
                  aria-label={t(`lists.colors.${color}`)}
                  onClick={() => choose(color)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform duration-150 hover:scale-110 ${
                    colorToken === color ? 'border-content' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: `var(--list-${color})` }}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
