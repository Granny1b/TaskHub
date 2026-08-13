/**
 * How to write the search shortcut for the machine it is being read on.
 *
 * A Windows shop is the audience, so `Ctrl K` is what almost everyone sees. But
 * printing "Ctrl" on a Mac is worse than printing nothing: the key is Cmd, the
 * hint is wrong, and a wrong hint is a small betrayal of the toolbar.
 */

/** Pure so it can be tested without pretending to be a browser. */
export function shortcutLabelFor(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

export function searchShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';

  /*
    `navigator.platform` is deprecated but still the only thing every browser
    agrees on. `userAgentData.platform` is the replacement and is missing in
    Safari and Firefox — which is to say, missing on most of the Macs this is
    trying to detect. Prefer it where it exists, fall back where it does not.
  */
  const modern = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return shortcutLabelFor(modern ?? navigator.platform ?? '');
}
