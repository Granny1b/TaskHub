import { describe, expect, it } from 'vitest';
import { isValidIsoDate, isValidIsoDateTime, nowIso, todayIso } from './dates.js';

describe('isValidIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidIsoDate('2026-08-11')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects a date that matches the pattern but does not exist', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
  });

  it('rejects the wrong shape', () => {
    expect(isValidIsoDate('11/08/2026')).toBe(false);
    expect(isValidIsoDate('2026-8-11')).toBe(false);
    expect(isValidIsoDate('2026-08-11T00:00:00Z')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });
});

describe('isValidIsoDateTime', () => {
  it('accepts a full instant', () => {
    expect(isValidIsoDateTime('2026-08-11T09:30:00.000Z')).toBe(true);
  });

  it('rejects a bare date and other junk', () => {
    expect(isValidIsoDateTime('2026-08-11')).toBe(false);
    expect(isValidIsoDateTime('not a date at all')).toBe(false);
  });
});

describe('todayIso', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayIso(new Date('2026-08-11T12:00:00Z'))).toBe('2026-08-11');
  });

  it('resolves the calendar date in the business timezone, not UTC', () => {
    // 22:30 UTC on 10 August is already 11 August in Stockholm (UTC+2 in summer).
    // Stamping a completedDate from UTC here would record the wrong day.
    const instant = new Date('2026-08-10T22:30:00Z');
    expect(todayIso(instant, 'Europe/Stockholm')).toBe('2026-08-11');
    expect(todayIso(instant, 'UTC')).toBe('2026-08-10');
  });

  it('handles the winter offset too', () => {
    const instant = new Date('2026-01-10T23:30:00Z');
    expect(todayIso(instant, 'Europe/Stockholm')).toBe('2026-01-11');
  });
});

describe('nowIso', () => {
  it('returns a full ISO instant', () => {
    expect(nowIso(new Date('2026-08-11T09:30:00Z'))).toBe('2026-08-11T09:30:00.000Z');
  });
});
