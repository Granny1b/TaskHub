/**
 * Feature flags (§9.5).
 *
 * Everything the spec puts out of scope for v1 has a flag here, defaulted to
 * false. The point is that the seam exists: when one of these is built, the
 * work is turning a flag on and filling in the branch, not discovering that the
 * architecture never allowed for it.
 *
 * Plain booleans on purpose. A flag service is a Phase-2 concern and would be
 * over-engineering today.
 */
export const features = {
  /** Offer "also complete all subtasks?" when a parent is ticked (§4). */
  cascadeComplete: false,

  /* --- Explicitly out of scope for v1 (§1) --- */
  realtimeCollaboration: false,
  notifications: false,
  emailDigest: false,
  ganttView: false,
  calendarView: false,
  boardView: false,
  timeTracking: false,
  taskComments: false,
  mentions: false,
  recurringTasks: false,
  monitorG5Integration: false,
  attachmentContentSearch: false,

  /* --- Phase-2 infrastructure, seams present, handlers no-op --- */
  auditLog: false,
  orphanAttachmentCleanup: false,
  projectionBlob: false,
} as const;

export type FeatureName = keyof typeof features;

export function isEnabled(name: FeatureName): boolean {
  return features[name];
}
