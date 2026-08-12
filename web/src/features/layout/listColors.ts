/**
 * The colours a user can put on a list.
 *
 * `TaskList.colorToken` stores the *name* — `blue`, never `#2563eb`. The hex
 * lives in `tokens.css` under both themes, so a re-skin never has to migrate
 * data, and a colour that reads well on white can be lifted for dark mode
 * without anyone editing their lists.
 *
 * `null` is a real choice, not an absence: it means "no colour", and the list
 * icon falls back to the panel's normal foreground.
 */

export const LIST_COLORS = ['blue', 'green', 'teal', 'amber', 'red', 'purple', 'pink'] as const;

export type ListColor = (typeof LIST_COLORS)[number];

/** CSS value for a stored token, or null when there is no colour to apply. */
export function listColorVar(colorToken: string | null | undefined): string | null {
  if (colorToken === null || colorToken === undefined) return null;
  // An unknown token — hand-edited, or left over from an older palette — is
  // treated as no colour rather than rendered as a broken `var()`.
  return (LIST_COLORS as readonly string[]).includes(colorToken)
    ? `var(--list-${colorToken})`
    : null;
}
