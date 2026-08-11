import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  changeCompletionKind,
  changeCompletionKindByDepth,
  migrate,
  migrations,
  readSchemaVersion,
  runMigrations,
  type MigrationRegistry,
} from './migrations.js';
import { CURRENT_SCHEMA_VERSION } from './schemas.js';
import { document, mainTask, subtask, taskWithChildren } from './__testing__/fixtures.js';

describe('the migration pipeline', () => {
  it('runs on every read and returns a validated document', () => {
    const source = document();
    const result = migrate(JSON.parse(JSON.stringify(source)));
    expect(result.id).toBe(source.id);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('adopts a document written without a schemaVersion via the 0 -> 1 step', () => {
    const raw = JSON.parse(JSON.stringify(document())) as Record<string, unknown>;
    delete raw['schemaVersion'];

    const result = migrate(raw);
    expect(result.schemaVersion).toBe(1);
  });

  it('ships a registered migration from version 0', () => {
    expect(migrations[0]).toBeTypeOf('function');
  });

  it('chains multiple steps in order', () => {
    const registry: MigrationRegistry = {
      1: (doc) => ({ ...doc, schemaVersion: 2, addedInV2: true }),
      2: (doc) => ({ ...doc, schemaVersion: 3, addedInV3: true }),
    };

    const result = runMigrations({ schemaVersion: 1 }, registry, 3);
    expect(result).toEqual({ schemaVersion: 3, addedInV2: true, addedInV3: true });
  });

  it('is a no-op when the document is already current', () => {
    const input = { schemaVersion: 3, untouched: true };
    expect(runMigrations(input, {}, 3)).toBe(input);
  });

  it('throws when a step in the chain is missing', () => {
    expect(() => runMigrations({ schemaVersion: 1 }, {}, 3)).toThrow(DomainError);
  });

  it('throws rather than looping when a migration fails to advance the version', () => {
    const registry: MigrationRegistry = { 1: (doc) => ({ ...doc }) };
    expect(() => runMigrations({ schemaVersion: 1 }, registry, 2)).toThrow(/did not advance/);
  });

  it('refuses to read a document newer than this build understands', () => {
    expect(() => runMigrations({ schemaVersion: 99 }, {}, 1)).toThrow(/newer than this build/);
  });

  it('rejects non-object input', () => {
    expect(() => migrate(null)).toThrow(DomainError);
    expect(() => migrate([])).toThrow(DomainError);
    expect(() => migrate('a string')).toThrow(DomainError);
  });

  it('rejects a document that fails validation after migration', () => {
    const raw = JSON.parse(JSON.stringify(document())) as Record<string, unknown>;
    raw['root'] = { ...(raw['root'] as object), title: '' };
    expect(() => migrate(raw)).toThrow(DomainError);
  });

  it('rejects a document whose id does not match its root', () => {
    const raw = JSON.parse(JSON.stringify(document())) as Record<string, unknown>;
    raw['id'] = '01JGZ0000000000000000ZZZZ';
    expect(() => migrate(raw)).toThrow(DomainError);
  });

  it('treats a malformed schemaVersion as 0', () => {
    expect(readSchemaVersion({ schemaVersion: 'two' })).toBe(0);
    expect(readSchemaVersion({ schemaVersion: -1 })).toBe(0);
    expect(readSchemaVersion({ schemaVersion: 1.5 })).toBe(0);
    expect(readSchemaVersion({})).toBe(0);
  });
});

describe('changeCompletionKind', () => {
  it('is a no-op when the kind already matches', () => {
    const task = mainTask();
    expect(changeCompletionKind(task, 'percent')).toBe(task);
  });

  it('preserves isComplete when converting percent to checkbox', () => {
    const task = mainTask({
      completion: { kind: 'percent', percent: 40, isComplete: true, percentSource: 'manual' },
    });
    const converted = changeCompletionKind(task, 'checkbox');
    expect(converted.completion).toEqual({ kind: 'checkbox', isComplete: true });
  });

  it('preserves isComplete when converting checkbox to percent', () => {
    const done = subtask({ completion: { kind: 'checkbox', isComplete: true } });
    expect(changeCompletionKind(done, 'percent').completion).toEqual({
      kind: 'percent',
      percent: 100,
      isComplete: true,
      percentSource: 'derived',
    });
  });

  it('starts an incomplete converted node at zero percent', () => {
    expect(changeCompletionKind(subtask(), 'percent').completion).toEqual({
      kind: 'percent',
      percent: 0,
      isComplete: false,
      percentSource: 'derived',
    });
  });

  it('applies a new policy across a whole tree by depth', () => {
    const converted = changeCompletionKindByDepth(taskWithChildren(2, 1), (depth) =>
      depth === 0 ? 'checkbox' : 'percent',
    );

    expect(converted.completion.kind).toBe('checkbox');
    expect(converted.children.map((child) => child.completion.kind)).toEqual([
      'percent',
      'percent',
    ]);
    // The first child was complete; that fact survives the conversion.
    expect(converted.children[0]?.completion.isComplete).toBe(true);
  });
});
