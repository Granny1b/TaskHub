import { useCallback, useEffect, useState } from 'react';

/**
 * Theme selection.
 *
 * Three states, not two. "System" is the default and is a real choice, not the
 * absence of one: someone whose OS switches to dark at dusk expects the app to
 * follow. An explicit light or dark choice overrides it and is remembered.
 *
 * The mechanism lives in tokens.css: `[data-theme='dark']` wins outright, and
 * `@media (prefers-color-scheme: dark)` applies only when the root is not
 * explicitly light. This module's only job is to set the attribute.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'taskhub.theme';

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }

  // Keep the UA in step so form controls, scrollbars and the address bar match
  // the app rather than staying stubbornly light.
  root.style.colorScheme = preference === 'system' ? 'light dark' : preference;
}

/** Apply the stored preference before first paint, to avoid a flash of light. */
export function initialiseTheme(): void {
  applyTheme(readThemePreference());
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyTheme(preference);
    try {
      if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* Private browsing. The choice still applies for this session. */
    }
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system',
    );
  }, []);

  return { preference, setPreference, cycle };
}
