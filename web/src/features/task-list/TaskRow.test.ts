import { describe, expect, it } from 'vitest';
import { subtaskAffordances } from './TaskRow.js';

/**
 * The rules the desktop grid and the phone card used to disagree about.
 *
 * Each case below is a state a row was actually observed in, in a browser,
 * before this function existed.
 */
describe('subtaskAffordances', () => {
  const state = (overrides: Partial<Parameters<typeof subtaskAffordances>[0]> = {}) => ({
    hasChildren: false,
    expanded: false,
    addingChild: false,
    ...overrides,
  });

  describe('the chevron', () => {
    it('is absent on a closed row with no subtasks', () => {
      // Nothing to expand, so no control that pretends there is.
      expect(subtaskAffordances(state()).chevron).toBe(false);
    });

    it('is present on a row that has subtasks', () => {
      expect(subtaskAffordances(state({ hasChildren: true })).chevron).toBe(true);
    });

    it('is present on an empty row that something has opened', () => {
      /*
        The regression this exists for. Pressing + expands the row, and a row
        with no subtasks used to get no chevron at all — so cancelling left it
        open, empty, and impossible to close from the row itself.
      */
      expect(subtaskAffordances(state({ expanded: true })).chevron).toBe(true);
    });
  });

  describe('the "+ new subtask" button', () => {
    it('is absent while the row is closed', () => {
      expect(subtaskAffordances(state()).addButton).toBe(false);
      expect(subtaskAffordances(state({ hasChildren: true })).addButton).toBe(false);
    });

    it('is present on an open row with no subtasks yet', () => {
      expect(subtaskAffordances(state({ expanded: true })).addButton).toBe(true);
    });

    it('stays once the row has subtasks', () => {
      /*
        The other half of the report. The desktop only offered this button
        while a task had no subtasks, so it vanished the moment someone used
        it — one subtask per task by inline route, and a hover-only + for the
        second.
      */
      expect(subtaskAffordances(state({ expanded: true, hasChildren: true })).addButton).toBe(true);
    });

    it('gives way to the input it opens', () => {
      // Otherwise the button sits under its own text field.
      expect(subtaskAffordances(state({ expanded: true, addingChild: true })).addButton).toBe(
        false,
      );
    });

    it('does not vary with the subtasks at all', () => {
      /*
        An expanded row renders before its aggregate arrives, so `hasChildren`
        flips from the summary's answer to the document's as it loads. A rule
        that read it made the button flash in and out; this one must not move.
      */
      const empty = subtaskAffordances(state({ expanded: true, hasChildren: false }));
      const populated = subtaskAffordances(state({ expanded: true, hasChildren: true }));
      expect(empty.addButton).toBe(populated.addButton);
    });
  });
});
