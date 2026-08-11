import { PERCENT_MAX, PERCENT_MIN } from './constants.js';
import type { MutationContext } from './context.js';
import { invalidOperation } from './errors.js';
import type { Completion, CompletionKind, TaskNode } from './schemas.js';

/**
 * Every completion rule in the spec lives in this module. No component, handler
 * or repository inspects the `Completion` union directly — they call these
 * functions. That is what keeps "what does done mean" answerable in one place
 * after five more features.
 *
 * The governing principle: **the checkbox is the sole authority on "done".**
 * Percent is progress reporting and nothing more.
 */

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The only function anywhere that answers "is this done?".
 *
 * Reads `isComplete` for both kinds. Note what it does *not* do: it never looks
 * at percent. A main task at 100% is not complete until someone says it is, and
 * a main task at 40% is complete the moment someone ticks it.
 */
export function isTaskComplete(node: TaskNode): boolean {
  return node.completion.isComplete;
}

/** Percent for percent-kind nodes; null for checkbox nodes, which have none. */
export function getPercent(node: TaskNode): number | null {
  return node.completion.kind === 'percent' ? node.completion.percent : null;
}

export function isPercentDerived(node: TaskNode): boolean {
  return node.completion.kind === 'percent' && node.completion.percentSource === 'derived';
}

/**
 * Subtask rollup. Derived, never stored (§4 "Rollup rule") — the only place a
 * denormalised count is allowed to exist is the disposable blob metadata cache.
 */
export function countChildren(node: TaskNode): { total: number; done: number } {
  let done = 0;
  for (const child of node.children) {
    if (isTaskComplete(child)) done += 1;
  }
  return { total: node.children.length, done };
}

/** `round(done / total * 100)`. Zero children has no meaningful answer. */
export function derivePercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return PERCENT_MIN;
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(value)));
}

/* -------------------------------------------------------------------------- */
/* Construction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A fresh completion value for the given kind.
 *
 * Percent nodes start `derived` so that adding subtasks to a brand-new main
 * task drives the bar automatically — which is the behaviour the user asked
 * for. The "zero children falls back to manual" rule in the spec applies to the
 * *transition* when the last child is removed, not to a task that never had
 * any. See ADR-0008 for why those two readings had to be separated.
 */
export function createCompletion(kind: CompletionKind): Completion {
  if (kind === 'percent') {
    return { kind: 'percent', percent: 0, isComplete: false, percentSource: 'derived' };
  }
  return { kind: 'checkbox', isComplete: false };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

function withAudit(node: TaskNode, ctx: MutationContext): TaskNode {
  return { ...node, updatedAt: ctx.now, updatedBy: ctx.actor };
}

/**
 * Apply the `completedDate` (Färdig datum) invariant, which is identical for
 * both completion kinds:
 *
 *   false → true   stamp today, but only if it is currently empty
 *   true  → false  clear it
 *   unchanged      leave it exactly as it is
 *
 * The "only if empty" clause is what stops a user's manual date correction from
 * being stomped by a later toggle.
 */
function applyCompletedDate(
  node: TaskNode,
  wasComplete: boolean,
  isComplete: boolean,
  ctx: MutationContext,
): string | null {
  if (wasComplete === isComplete) return node.completedDate;
  if (isComplete) return node.completedDate ?? ctx.today;
  return null;
}

/**
 * Tick or untick the completion checkbox — the override on percent nodes.
 *
 * Critically, this **preserves the stored percent**. A main task can be complete
 * at 40%, and unticking restores 40% rather than overwriting it with 100. The
 * UI shows the real number beside the tick so nothing implies data we do not hold.
 *
 * It also does not cascade to children: their real state stays intact and
 * visible on expand.
 */
export function setComplete(node: TaskNode, isComplete: boolean, ctx: MutationContext): TaskNode {
  const wasComplete = node.completion.isComplete;
  const completedDate = applyCompletedDate(node, wasComplete, isComplete, ctx);

  const completion: Completion =
    node.completion.kind === 'percent'
      ? { ...node.completion, isComplete }
      : { ...node.completion, isComplete };

  return withAudit({ ...node, completion, completedDate }, ctx);
}

/**
 * Set the percent by hand.
 *
 * Two rules meet here. Editing the percent flips `percentSource` to `manual`
 * permanently — the user has taken the wheel, and a later subtask edit must not
 * silently take it back. And reaching 100 does **not** auto-tick the checkbox:
 * reaching 100% and declaring something finished are different acts, and this
 * is a quality record.
 */
export function setPercent(node: TaskNode, percent: number, ctx: MutationContext): TaskNode {
  if (node.completion.kind !== 'percent') {
    throw invalidOperation('Cannot set a percent on a checkbox-completion node', {
      nodeId: node.id,
      kind: node.completion.kind,
    });
  }

  return withAudit(
    {
      ...node,
      completion: {
        ...node.completion,
        percent: clampPercent(percent),
        percentSource: 'manual',
      },
    },
    ctx,
  );
}

/**
 * The "back to auto" affordance. Flips `percentSource` to `derived` and
 * immediately recomputes from the current children.
 */
export function setPercentToAuto(node: TaskNode, ctx: MutationContext): TaskNode {
  if (node.completion.kind !== 'percent') {
    throw invalidOperation('Cannot set a percent source on a checkbox-completion node', {
      nodeId: node.id,
      kind: node.completion.kind,
    });
  }

  const { total, done } = countChildren(node);
  return withAudit(
    {
      ...node,
      completion: {
        ...node.completion,
        percentSource: 'derived',
        percent: derivePercent(done, total),
      },
    },
    ctx,
  );
}

/** Manual edit of Färdig datum. Never overwritten by a toggle afterwards. */
export function setCompletedDate(
  node: TaskNode,
  completedDate: string | null,
  ctx: MutationContext,
): TaskNode {
  return withAudit({ ...node, completedDate }, ctx);
}

/**
 * Recompute a node's derived percent from its children. Call after any child
 * mutation — add, remove, or completion toggle.
 *
 * Handles the awkward edge the spec calls out: when the last subtask is deleted
 * from a derived parent, "derived" stops meaning anything, so the source flips
 * to manual and the last computed value is kept rather than reset to zero.
 *
 * A manual parent is left completely alone, including when subtasks are added.
 * No surprise reversals.
 */
export function recomputeDerivedPercent(node: TaskNode, ctx: MutationContext): TaskNode {
  if (node.completion.kind !== 'percent') return node;
  if (node.completion.percentSource !== 'derived') return node;

  const { total, done } = countChildren(node);

  // Derived with nothing to derive from: keep the number, drop the claim.
  if (total === 0) {
    return withAudit({ ...node, completion: { ...node.completion, percentSource: 'manual' } }, ctx);
  }

  const percent = derivePercent(done, total);
  if (percent === node.completion.percent) return node;

  return withAudit({ ...node, completion: { ...node.completion, percent } }, ctx);
}

/**
 * How many direct children are still open. Drives the quiet inline hint
 * ("2 open subtasks") shown when a parent is completed — inform, never block.
 */
export function openChildCount(node: TaskNode): number {
  const { total, done } = countChildren(node);
  return total - done;
}
