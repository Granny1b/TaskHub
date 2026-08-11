import { nowIso, todayIso } from './dates.js';
import { BUSINESS_TIME_ZONE } from './constants.js';

/**
 * Every mutation takes a context rather than reading the clock itself.
 *
 * Two reasons. First, the domain stays pure and every time-dependent rule
 * (`completedDate` stamping in particular) is testable without freezing global
 * state. Second, `today` and `now` are genuinely different values — an instant
 * and a calendar date in a specific timezone — and resolving the calendar date
 * is a decision the caller should make explicitly, not something buried in a
 * `new Date()` deep in a rule.
 */
export interface MutationContext {
  /** Entra ID object id of the acting principal. Never a display name. */
  readonly actor: string;
  /** ISO 8601 instant, for `createdAt` / `updatedAt`. */
  readonly now: string;
  /** ISO calendar date in the business timezone, for `date` / `completedDate`. */
  readonly today: string;
}

export function createContext(
  actor: string,
  at: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): MutationContext {
  return {
    actor,
    now: nowIso(at),
    today: todayIso(at, timeZone),
  };
}
