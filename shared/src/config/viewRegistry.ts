/**
 * View registry (§9.6).
 *
 * Task rendering goes through a registry with exactly one entry in v1. Board
 * and calendar views become registry entries later rather than conditionals
 * threaded through the list component.
 */

export type ViewId = 'list' | 'board' | 'calendar' | 'gantt';

export interface ViewDefinition {
  readonly id: ViewId;
  /** i18n key, not a literal. */
  readonly labelKey: string;
  /** Icon name resolved by the web layer; /shared stays free of components. */
  readonly icon: string;
  readonly enabled: boolean;
}

export const viewRegistry: readonly ViewDefinition[] = [
  { id: 'list', labelKey: 'views.list', icon: 'list', enabled: true },
];

export const DEFAULT_VIEW: ViewId = 'list';

export function enabledViews(): ViewDefinition[] {
  return viewRegistry.filter((view) => view.enabled);
}
