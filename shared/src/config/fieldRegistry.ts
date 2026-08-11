/**
 * Custom field registry (§9.2).
 *
 * `custom: Record<string, unknown>` on every node is the escape hatch that lets
 * new per-task fields exist without a schema migration. This registry is what
 * stops that escape hatch becoming a junk drawer: a field is only rendered and
 * validated if it is declared here, so adding one is a registry entry rather
 * than a form rewrite.
 *
 * Empty in v1 by design. The spec is explicit that priority, assignee and
 * labels are **not** v1 fields — the default UI stays as clean as the source
 * spreadsheet. This is where they would go if asked for.
 */

export type CustomFieldKind = 'text' | 'number' | 'date' | 'boolean' | 'select';

export interface CustomFieldDefinition {
  /** Key inside `node.custom`. Stable forever once shipped. */
  readonly key: string;
  /** i18n key for the label, never a literal — the UI is Swedish-first. */
  readonly labelKey: string;
  readonly kind: CustomFieldKind;
  /** Which depths show this field. Empty means every depth. */
  readonly depths?: readonly number[];
  /** Whether the list view shows it as a column, or only the detail pane. */
  readonly showInList: boolean;
  readonly options?: readonly { value: string; labelKey: string }[];
}

export const fieldRegistry: readonly CustomFieldDefinition[] = [];

export function fieldsForDepth(depth: number): CustomFieldDefinition[] {
  return fieldRegistry.filter(
    (field) => field.depths === undefined || field.depths.includes(depth),
  );
}

export function listColumnFields(): CustomFieldDefinition[] {
  return fieldRegistry.filter((field) => field.showInList);
}
