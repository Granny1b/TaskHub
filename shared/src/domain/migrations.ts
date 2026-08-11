import { DomainError } from './errors.js';
import {
  CURRENT_SCHEMA_VERSION,
  validatedTaskDocumentSchema,
  type Completion,
  type CompletionKind,
  type TaskDocument,
  type TaskNode,
} from './schemas.js';

/**
 * Versioned document evolution (§4).
 *
 * Every read goes through `migrate()`. Shipping this in v1 with nothing to do
 * is the entire point: the pipeline exists, it is tested, and the day the shape
 * changes the work is adding one function to a registry rather than writing a
 * migration framework under pressure against live data.
 */

export type RawDocument = Record<string, unknown>;

/** Upgrades a document from version N to version N+1. Must be pure. */
export type Migration = (doc: RawDocument) => RawDocument;

/** Keyed by the version the migration upgrades *from*. */
export type MigrationRegistry = Record<number, Migration>;

/**
 * 0 → 1. Adopts a document written before schema versioning existed (or one
 * hand-authored without the field). Structurally an identity migration: it only
 * stamps the version.
 */
const migrateV0toV1: Migration = (doc) => ({ ...doc, schemaVersion: 1 });

export const migrations: MigrationRegistry = {
  0: migrateV0toV1,
};

/** Missing or malformed versions are treated as 0 and adopted by the 0 → 1 step. */
export function readSchemaVersion(raw: RawDocument): number {
  const value = raw['schemaVersion'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

/**
 * Apply migrations in sequence until the document reaches `targetVersion`.
 *
 * Exported with an injectable registry so tests can prove multi-step chaining
 * without waiting for the codebase to actually have three schema versions.
 */
export function runMigrations(
  raw: RawDocument,
  registry: MigrationRegistry = migrations,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): RawDocument {
  let document = raw;
  let version = readSchemaVersion(document);
  let steps = 0;

  while (version < targetVersion) {
    const migration = registry[version];
    if (migration === undefined) {
      throw new DomainError(
        'validation_failed',
        `No migration registered from schema version ${version} to ${version + 1}`,
        { fromVersion: version, targetVersion },
      );
    }

    document = migration(document);

    const nextVersion = readSchemaVersion(document);
    if (nextVersion <= version) {
      throw new DomainError(
        'validation_failed',
        `Migration from version ${version} did not advance schemaVersion`,
        { fromVersion: version, resultingVersion: nextVersion },
      );
    }
    version = nextVersion;

    steps += 1;
    if (steps > 100) {
      throw new DomainError('validation_failed', 'Migration pipeline did not converge', {
        steps,
      });
    }
  }

  if (version > targetVersion) {
    throw new DomainError(
      'validation_failed',
      `Document schema version ${version} is newer than this build understands (${targetVersion}). ` +
        'Refusing to read it rather than silently dropping fields.',
      { documentVersion: version, supportedVersion: targetVersion },
    );
  }

  return document;
}

/**
 * The read path: migrate, then validate against the current schema.
 *
 * Validation happens *after* migration, so a stored document only ever has to
 * satisfy the schema of its own version.
 */
export function migrate(raw: unknown): TaskDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DomainError('validation_failed', 'Task document must be a JSON object');
  }

  const migrated = runMigrations(raw as RawDocument);
  const parsed = validatedTaskDocumentSchema.safeParse(migrated);

  if (!parsed.success) {
    throw new DomainError('validation_failed', 'Task document failed validation after migration', {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

/**
 * Convert a node between completion kinds, preserving what survives the change.
 *
 * This ships alongside `completionPolicy` so that flipping a depth's policy is
 * one config line plus one call to this — not a data-model rewrite (§4).
 *
 * `isComplete` always survives, because it is the authoritative fact. `percent`
 * cannot survive a move to `checkbox`, since a checkbox node has nowhere to put
 * it; that loss is the reason this is an explicit call and not an implicit cast.
 */
export function changeCompletionKind(node: TaskNode, kind: CompletionKind): TaskNode {
  if (node.completion.kind === kind) return node;

  const completion: Completion =
    kind === 'percent'
      ? {
          kind: 'percent',
          percent: node.completion.isComplete ? 100 : 0,
          isComplete: node.completion.isComplete,
          percentSource: 'derived',
        }
      : { kind: 'checkbox', isComplete: node.completion.isComplete };

  return { ...node, completion };
}

/** Apply `changeCompletionKind` across a whole tree, by depth, from policy. */
export function changeCompletionKindByDepth(
  root: TaskNode,
  kindForDepth: (depth: number) => CompletionKind,
): TaskNode {
  const convert = (node: TaskNode, depth: number): TaskNode => {
    const converted = changeCompletionKind(node, kindForDepth(depth));
    return {
      ...converted,
      children: converted.children.map((child) => convert(child, depth + 1)),
    };
  };
  return convert(root, 0);
}
