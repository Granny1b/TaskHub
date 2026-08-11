import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import {
  activeLists,
  createTaskList,
  createTaskListsDocument,
  findList,
  parseTaskListsDocument,
  renameTaskList,
  reorderTaskLists,
  restoreTaskList,
  setTaskListColor,
  softDeleteTaskList,
} from './taskLists.js';
import { ctx } from './__testing__/fixtures.js';

/** Build a document with named lists, returning both for convenience. */
function withLists(...names: string[]) {
  let doc = createTaskListsDocument();
  const ids: string[] = [];
  for (const name of names) {
    const result = createTaskList(doc, { name }, ctx());
    doc = result.document;
    ids.push(result.list.id);
  }
  return { doc, ids };
}

describe('creating lists', () => {
  it('starts empty', () => {
    expect(activeLists(createTaskListsDocument())).toEqual([]);
  });

  it('lets the user name a list whatever they like', () => {
    const { document } = createTaskList(
      createTaskListsDocument(),
      { name: 'Maskin 7 — spindelbyte' },
      ctx(),
    );
    expect(activeLists(document)[0]?.name).toBe('Maskin 7 — spindelbyte');
  });

  it('trims incidental whitespace', () => {
    const { list } = createTaskList(createTaskListsDocument(), { name: '  Att göra  ' }, ctx());
    expect(list.name).toBe('Att göra');
  });

  it('appends each new list after the last', () => {
    const { doc } = withLists('Ett', 'Två', 'Tre');
    expect(activeLists(doc).map((list) => list.name)).toEqual(['Ett', 'Två', 'Tre']);
  });

  it('stamps audit fields', () => {
    const { list } = createTaskList(
      createTaskListsDocument(),
      { name: 'X' },
      ctx({ actor: 'anna' }),
    );
    expect(list.createdBy).toBe('anna');
    expect(list.deletedAt).toBeNull();
  });
});

describe('editing lists', () => {
  it('renames', () => {
    const { doc, ids } = withLists('Gammalt namn');
    const renamed = renameTaskList(doc, ids[0] ?? '', 'Nytt namn', ctx());
    expect(activeLists(renamed)[0]?.name).toBe('Nytt namn');
  });

  it('sets a colour token, never a raw hex', () => {
    const { doc, ids } = withLists('Ett');
    const coloured = setTaskListColor(doc, ids[0] ?? '', 'accent-500', ctx());
    expect(findList(coloured, ids[0] ?? '')?.colorToken).toBe('accent-500');
  });

  it('throws for an unknown list', () => {
    expect(() => renameTaskList(createTaskListsDocument(), 'nope', 'x', ctx())).toThrow(
      DomainError,
    );
  });
});

describe('deleting lists', () => {
  it('soft deletes, hiding the list without destroying it', () => {
    const { doc, ids } = withLists('Ett', 'Två');
    const deleted = softDeleteTaskList(doc, ids[0] ?? '', ctx());

    expect(activeLists(deleted).map((list) => list.name)).toEqual(['Två']);
    expect(deleted.lists).toHaveLength(2);
    expect(findList(deleted, ids[0] ?? '')?.deletedAt).not.toBeNull();
  });

  it('restores a deleted list', () => {
    const { doc, ids } = withLists('Ett');
    const restored = restoreTaskList(
      softDeleteTaskList(doc, ids[0] ?? '', ctx()),
      ids[0] ?? '',
      ctx(),
    );
    expect(activeLists(restored)).toHaveLength(1);
  });
});

describe('reordering lists', () => {
  it('moves a list to the head', () => {
    const { doc, ids } = withLists('Ett', 'Två', 'Tre');
    const reordered = reorderTaskLists(doc, ids[2] ?? '', 0, ctx());
    expect(activeLists(reordered).map((list) => list.name)).toEqual(['Tre', 'Ett', 'Två']);
  });

  it('leaves soft-deleted lists out of the ordering', () => {
    const { doc, ids } = withLists('Ett', 'Två', 'Tre');
    const deleted = softDeleteTaskList(doc, ids[1] ?? '', ctx());
    const reordered = reorderTaskLists(deleted, ids[2] ?? '', 0, ctx());
    expect(activeLists(reordered).map((list) => list.name)).toEqual(['Tre', 'Ett']);
  });

  it('throws when the moved list does not exist', () => {
    const { doc } = withLists('Ett');
    expect(() => reorderTaskLists(doc, 'nope', 0, ctx())).toThrow(DomainError);
  });
});

describe('parsing', () => {
  it('accepts a valid document', () => {
    const { doc } = withLists('Ett');
    expect(parseTaskListsDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('rejects a malformed document rather than guessing', () => {
    expect(() => parseTaskListsDocument({ schemaVersion: 1 })).toThrow(DomainError);
    expect(() => parseTaskListsDocument(null)).toThrow(DomainError);
  });

  it('rejects a list name longer than the limit', () => {
    const { doc } = withLists('Ett');
    const broken = { ...doc, lists: [{ ...doc.lists[0], name: 'x'.repeat(200) }] };
    expect(() => parseTaskListsDocument(broken)).toThrow(DomainError);
  });
});
