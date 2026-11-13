import { describe, expect, it } from 'vitest';
import { parseSelection, resolveSelection } from './lastSelection.js';

describe('parseSelection', () => {
  it('restores a list', () => {
    expect(parseSelection('{"kind":"list","id":"abc"}')).toEqual({ kind: 'list', id: 'abc' });
  });

  it('restores the fixed sections', () => {
    expect(parseSelection('{"kind":"ungrouped"}')).toEqual({ kind: 'ungrouped' });
    expect(parseSelection('{"kind":"files"}')).toEqual({ kind: 'files' });
  });

  it('falls back to all for nothing stored', () => {
    expect(parseSelection(null)).toEqual({ kind: 'all' });
  });

  it('falls back to all for anything it does not recognise', () => {
    expect(parseSelection('not json')).toEqual({ kind: 'all' });
    expect(parseSelection('{"kind":"calendar"}')).toEqual({ kind: 'all' });
    // A list without an id selects nothing.
    expect(parseSelection('{"kind":"list"}')).toEqual({ kind: 'all' });
    expect(parseSelection('"list"')).toEqual({ kind: 'all' });
  });
});

describe('resolveSelection', () => {
  const jobb = { kind: 'list', id: 'jobb' } as const;

  it('keeps a remembered list that still exists', () => {
    expect(resolveSelection(jobb, ['jobb', 'privat'])).toEqual(jobb);
  });

  it('trusts the remembered list until the lists have loaded', () => {
    // Otherwise every reload would fall back before the answer arrived.
    expect(resolveSelection(jobb, undefined)).toEqual(jobb);
  });

  it('falls back to all when the list has been deleted', () => {
    expect(resolveSelection(jobb, ['privat'])).toEqual({ kind: 'all' });
  });

  it('never second-guesses a fixed section', () => {
    expect(resolveSelection({ kind: 'files' }, [])).toEqual({ kind: 'files' });
  });
});
