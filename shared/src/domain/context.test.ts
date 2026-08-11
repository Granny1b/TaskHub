import { describe, expect, it } from 'vitest';
import { createContext } from './context.js';
import { isUlid, newAttachmentId, newTaskId, newTaskListId } from './ids.js';

describe('createContext', () => {
  it('separates the instant from the calendar date', () => {
    const ctx = createContext('anna', new Date('2026-08-11T09:30:00Z'));
    expect(ctx.actor).toBe('anna');
    expect(ctx.now).toBe('2026-08-11T09:30:00.000Z');
    expect(ctx.today).toBe('2026-08-11');
  });

  it('resolves the calendar date in the business timezone by default', () => {
    // 22:30 UTC is already the next day in Stockholm. A completedDate stamped
    // from UTC here would be off by one.
    const ctx = createContext('anna', new Date('2026-08-10T22:30:00Z'));
    expect(ctx.today).toBe('2026-08-11');
  });

  it('accepts an explicit timezone', () => {
    const ctx = createContext('anna', new Date('2026-08-10T22:30:00Z'), 'UTC');
    expect(ctx.today).toBe('2026-08-10');
  });
});

describe('ids', () => {
  it('generates ULIDs', () => {
    expect(isUlid(newTaskId())).toBe(true);
    expect(isUlid(newAttachmentId())).toBe(true);
    expect(isUlid(newTaskListId())).toBe(true);
  });

  it('generates ids that sort by creation time', () => {
    const ids = Array.from({ length: 20 }, () => newTaskId());
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(ids);
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTaskId()));
    expect(ids.size).toBe(200);
  });

  it('rejects non-ULID strings', () => {
    expect(isUlid('not-a-ulid')).toBe(false);
    expect(isUlid('')).toBe(false);
    // I, L, O and U are excluded from Crockford base32.
    expect(isUlid('01JGZ00000000000000000ILOU')).toBe(false);
  });
});
