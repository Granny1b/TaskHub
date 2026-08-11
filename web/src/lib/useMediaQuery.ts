import { useEffect, useState } from 'react';

/**
 * Breakpoint state as a hook.
 *
 * The layout is not merely styled differently below `md` — list and detail
 * become separate *routes* rather than side-by-side regions — so the breakpoint
 * has to be a value React can branch on, not only a CSS media query.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);

    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md`. Above this the three-region desktop layout applies. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 768px)');
