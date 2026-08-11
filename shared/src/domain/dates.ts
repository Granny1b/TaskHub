import { BUSINESS_TIME_ZONE } from './constants.js';

/**
 * Calendar-date helpers.
 *
 * Two distinct string shapes live in the domain and they are not interchangeable:
 *   - ISO date      `YYYY-MM-DD`         — `date` (Datum), `completedDate` (Färdig datum)
 *   - ISO date-time `YYYY-MM-DDTHH:mm:ss.sssZ` — `createdAt`, `updatedAt`, `uploadedAt`
 *
 * Everything here is pure and platform-neutral: /shared is bundled into the
 * browser as well as the Functions host.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a syntactically valid *and* real calendar date.
 *
 * The regex alone accepts `2026-02-31`, so we round-trip through Date and check
 * the parts survived. `Date.parse` on a bare `YYYY-MM-DD` is specified as UTC,
 * which is what we want for a pure calendar comparison.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** True for a parseable ISO 8601 date-time. */
export function isValidIsoDateTime(value: string): boolean {
  if (value.length < 20) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * The calendar date "now" in the business timezone.
 *
 * `sv-SE` formats as `YYYY-MM-DD` natively, which is exactly the shape we store,
 * so this needs no manual padding or arithmetic.
 */
export function todayIso(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The current instant as an ISO date-time, for `createdAt` / `updatedAt`. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
