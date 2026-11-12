import { describe, expect, it } from 'vitest';
import { COMMENTS_PREVIEW_LENGTH, type TaskSummary } from '@taskhub/shared';
import { predictSummary } from './queries.js';

const summary: TaskSummary = {
  id: 'task-1',
  listId: null,
  title: 'Byt växellåda',
  commentsPreview: '',
  date: '2026-08-13',
  isComplete: false,
  percent: 40,
  completedDate: null,
  childCount: 4,
  childDoneCount: 2,
  attachmentCount: 1,
  updatedAt: '2026-08-13T09:30:00.000Z',
  order: 1000,
  etag: '"v1"',
};

describe('predictSummary', () => {
  it('ticks a collapsed row without waiting for the server', () => {
    expect(predictSummary(summary, { isComplete: true }).isComplete).toBe(true);
  });

  it('carries a new title and date straight into the row', () => {
    const next = predictSummary(summary, { title: 'Byt kullager', date: '2026-09-01' });
    expect(next.title).toBe('Byt kullager');
    expect(next.date).toBe('2026-09-01');
  });

  it('cuts a long comment to what the listing would hold', () => {
    const next = predictSummary(summary, { comments: 'x'.repeat(COMMENTS_PREVIEW_LENGTH + 50) });
    expect(next.commentsPreview).toHaveLength(COMMENTS_PREVIEW_LENGTH);
  });

  it('does not guess at values the server derives', () => {
    // Percent and the subtask counts come from the whole document, which a
    // collapsed row has not loaded.
    const next = predictSummary(summary, { isComplete: true, percent: 90 });
    expect(next.percent).toBe(40);
    expect(next.childDoneCount).toBe(2);
    expect(next.etag).toBe('"v1"');
  });

  it('leaves untouched fields alone', () => {
    expect(predictSummary(summary, {})).toEqual(summary);
  });
});
