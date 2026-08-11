// @vitest-environment jsdom
//
// Per-file rather than global: the domain and API suites are the bulk of the
// run and have no business paying jsdom's start-up cost for a module that only
// needs `localStorage`.
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences, setPreferences } from './preferences.js';

const STORAGE_KEY = 'taskhub.preferences';

describe('readPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the defaults when nothing is stored', () => {
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('defaults subtasks to inline, matching the workbook people are leaving', () => {
    // Changing this moves everyone's subtasks on the first day. It is a
    // deliberate choice, not an accident of ordering.
    expect(DEFAULT_PREFERENCES.subtaskDisplay).toBe('inline');
  });

  it('round-trips a stored preference', () => {
    setPreferences({ subtaskDisplay: 'detail' });
    expect(readPreferences().subtaskDisplay).toBe('detail');
  });

  it('keeps the other preferences when one is updated', () => {
    setPreferences({ showComments: false });
    setPreferences({ rowDensity: 'comfortable' });

    expect(readPreferences()).toEqual({
      ...DEFAULT_PREFERENCES,
      showComments: false,
      rowDensity: 'comfortable',
    });
  });

  it('fills in a preference the stored blob predates', () => {
    // Someone who set their preferences before `rowDensity` existed must get
    // the default for it, not `undefined` — which would render as no class at
    // all and quietly break the row.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ subtaskDisplay: 'detail' }));

    expect(readPreferences()).toEqual({
      ...DEFAULT_PREFERENCES,
      subtaskDisplay: 'detail',
    });
  });

  it('ignores a value outside the allowed set', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ subtaskDisplay: 'sidebar', rowDensity: 7, showComments: 'yes' }),
    );

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('survives a stored primitive', () => {
    window.localStorage.setItem(STORAGE_KEY, 'null');

    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});
