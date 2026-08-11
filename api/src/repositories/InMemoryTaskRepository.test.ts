import { describe, expect, it } from 'vitest';
import {
  DomainError,
  addChild,
  createContext,
  createTaskDocument,
  createTaskList,
  createTaskListsDocument,
  setComplete,
  softDeleteDocument,
  updateNode,
  type TaskDocument,
} from '@taskhub/shared';
import { InMemoryTaskListRepository, InMemoryTaskRepository } from './InMemoryTaskRepository.js';

const ctx = () => createContext('anna', new Date('2026-08-11T09:30:00Z'));

async function seed(
  repository: InMemoryTaskRepository,
  title: string,
  listId: string | null = null,
): Promise<{ document: TaskDocument; etag: string }> {
  return repository.create(createTaskDocument({ title, listId }, ctx()));
}

describe('InMemoryTaskRepository — CRUD', () => {
  it('creates and reads back', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'Byt växellåda');

    const loaded = await repository.get(created.document.id);
    expect(loaded?.document.root.title).toBe('Byt växellåda');
    expect(loaded?.etag).toBe(created.etag);
  });

  it('returns null for an unknown id rather than throwing', async () => {
    expect(await new InMemoryTaskRepository().get('nope')).toBeNull();
  });

  it('refuses to create the same id twice', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'X');
    await expect(repository.create(created.document)).rejects.toThrow(DomainError);
  });

  it('hands out copies, so a caller cannot mutate stored state by reference', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'Original');

    const loaded = await repository.get(created.document.id);
    if (loaded !== null) loaded.document.root.title = 'Tampered';

    expect((await repository.get(created.document.id))?.document.root.title).toBe('Original');
  });

  it('purges', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'X');
    await repository.purge(created.document.id);
    expect(await repository.get(created.document.id)).toBeNull();
  });
});

describe('InMemoryTaskRepository — optimistic concurrency', () => {
  it('accepts a replace carrying the current ETag', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'X');

    const renamed = { ...created.document, root: { ...created.document.root, title: 'Y' } };
    const saved = await repository.replace(renamed, created.etag);

    expect(saved.etag).not.toBe(created.etag);
    expect((await repository.get(created.document.id))?.document.root.title).toBe('Y');
  });

  it('rejects a replace carrying a stale ETag — no lost update', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'X');

    // Two clients read the same version.
    const first = await repository.get(created.document.id);
    const second = await repository.get(created.document.id);
    if (first === null || second === null) throw new Error('fixture failure');

    // The first writes and wins.
    await repository.replace(
      { ...first.document, root: { ...first.document.root, title: 'First wins' } },
      first.etag,
    );

    // The second still holds the old ETag and must fail rather than clobber.
    await expect(
      repository.replace(
        { ...second.document, root: { ...second.document.root, title: 'Second clobbers' } },
        second.etag,
      ),
    ).rejects.toMatchObject({ code: 'concurrency_conflict' });

    expect((await repository.get(created.document.id))?.document.root.title).toBe('First wins');
  });

  it('produces exactly one conflict when two subtask adds race', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'Delat arbete');

    const a = await repository.get(created.document.id);
    const b = await repository.get(created.document.id);
    if (a === null || b === null) throw new Error('fixture failure');

    const addTo = (entry: { document: TaskDocument; etag: string }, title: string) => {
      const { root } = addChild(entry.document.root, entry.document.root.id, { title }, ctx());
      return repository.replace({ ...entry.document, root }, entry.etag);
    };

    const results = await Promise.allSettled([addTo(a, 'Först'), addTo(b, 'Sedan')]);
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(rejected).toHaveLength(1);

    // The survivor's subtask is intact — neither write silently vanished.
    const final = await repository.get(created.document.id);
    expect(final?.document.root.children).toHaveLength(1);
  });

  it('rejects a replace of a task that does not exist', async () => {
    const repository = new InMemoryTaskRepository();
    const orphan = createTaskDocument({ title: 'Ghost' }, ctx());
    await expect(repository.replace(orphan, '"mem-1"')).rejects.toThrow(DomainError);
  });
});

describe('InMemoryTaskRepository — listing', () => {
  it('summarises without exposing the whole document', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'Med deluppgifter');

    const { root } = addChild(created.document.root, created.document.id, { title: 'Del' }, ctx());
    await repository.replace({ ...created.document, root }, created.etag);

    const [summary] = await repository.list();
    expect(summary?.childCount).toBe(1);
    expect(summary?.childDoneCount).toBe(0);
  });

  it('hides soft-deleted tasks by default and reveals them on request', async () => {
    const repository = new InMemoryTaskRepository();
    const created = await seed(repository, 'Borttagen');

    await repository.replace(softDeleteDocument(created.document, ctx()), created.etag);

    expect(await repository.list()).toHaveLength(0);
    expect(await repository.list({ includeDeleted: true })).toHaveLength(1);
  });

  it('filters by user-defined list, including the ungrouped case', async () => {
    const repository = new InMemoryTaskRepository();
    await seed(repository, 'I lista', '01JGZ0000000000000000ZZZ2');
    await seed(repository, 'Ogrupperad', null);

    expect(await repository.list({ listId: '01JGZ0000000000000000ZZZ2' })).toHaveLength(1);
    expect(await repository.list({ listId: null })).toHaveLength(1);
    expect(await repository.list()).toHaveLength(2);
  });

  it('filters by completion', async () => {
    const repository = new InMemoryTaskRepository();
    const open = await seed(repository, 'Öppen');
    const done = await seed(repository, 'Klar');

    await repository.replace(
      {
        ...done.document,
        root: updateNode(
          done.document.root,
          done.document.id,
          (n) => setComplete(n, true, ctx()),
          ctx(),
        ),
      },
      done.etag,
    );

    expect((await repository.list({ isComplete: false })).map((s) => s.id)).toEqual([
      open.document.id,
    ]);
    expect(await repository.list({ isComplete: true })).toHaveLength(1);
  });

  it('matches titles case-insensitively', async () => {
    const repository = new InMemoryTaskRepository();
    await seed(repository, 'Byt VÄXELLÅDA');
    await seed(repository, 'Kontrollera olja');

    expect(await repository.list({ q: 'växellåda' })).toHaveLength(1);
    expect(await repository.list({ q: '' })).toHaveLength(2);
  });

  it('returns summaries in creation order, courtesy of ULID sorting', async () => {
    const repository = new InMemoryTaskRepository();
    const first = await seed(repository, 'Ett');
    const second = await seed(repository, 'Två');

    const ids = (await repository.list()).map((summary) => summary.id);
    expect(ids).toEqual([first.document.id, second.document.id].sort((a, b) => a.localeCompare(b)));
  });
});

describe('InMemoryTaskListRepository', () => {
  it('treats an absent document as an empty set of lists', async () => {
    const { document, etag } = await new InMemoryTaskListRepository().get();
    expect(document.lists).toEqual([]);
    expect(etag).toBe('');
  });

  it('creates on first save and reads back', async () => {
    const repository = new InMemoryTaskListRepository();
    const { document } = createTaskList(createTaskListsDocument(), { name: 'Maskin 7' }, ctx());

    const saved = await repository.save(document, null);
    expect(saved.etag).not.toBe('');
    expect((await repository.get()).document.lists).toHaveLength(1);
  });

  it('refuses a second create', async () => {
    const repository = new InMemoryTaskListRepository();
    await repository.save(createTaskListsDocument(), null);
    await expect(repository.save(createTaskListsDocument(), null)).rejects.toThrow(DomainError);
  });

  it('enforces the ETag on update', async () => {
    const repository = new InMemoryTaskListRepository();
    const created = await repository.save(createTaskListsDocument(), null);

    const { document } = createTaskList(created.document, { name: 'Ny' }, ctx());
    await repository.save(document, created.etag);

    await expect(repository.save(document, created.etag)).rejects.toMatchObject({
      code: 'concurrency_conflict',
    });
  });

  it('rejects an update before anything exists', async () => {
    await expect(
      new InMemoryTaskListRepository().save(createTaskListsDocument(), '"mem-lists-1"'),
    ).rejects.toThrow(DomainError);
  });
});
