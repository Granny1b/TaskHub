import type { CompletionKind } from '../domain/schemas.js';

/**
 * Which completion shape a node gets, by depth.
 *
 * This is policy, not a hardcoded rule, so changing it later is a config edit
 * plus a `changeCompletionKind` migration call — not a data-model rewrite.
 * See docs/DECISIONS.md ADR-0006.
 *
 *   depth 0 — main tasks   → percent + override checkbox
 *   depth 1 — subtasks     → plain checkbox
 */
export const completionPolicy: Record<number, CompletionKind> = {
  0: 'percent',
  1: 'checkbox',
};

/** Depths beyond the table fall back to a checkbox. */
export const DEFAULT_COMPLETION_KIND: CompletionKind = 'checkbox';

export function completionKindForDepth(depth: number): CompletionKind {
  return completionPolicy[depth] ?? DEFAULT_COMPLETION_KIND;
}
