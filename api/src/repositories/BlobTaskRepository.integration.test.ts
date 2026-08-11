import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import {
  addChild,
  createContext,
  createTaskDocument,
  createTaskList,
  createTaskListsDocument,
  getPercent,
  isTaskComplete,
  setComplete,
  softDeleteDocument,
  updateNode,
  type TaskDocument,
} from '@taskhub/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { TaskService } from '../domain/taskService.js';
import { BlobTaskListRepository } from './BlobTaskListRepository.js';
import { BlobTaskRepository } from './BlobTaskRepository.js';
import type { ETagged } from './ITaskRepository.js';

/**
 * Phase 2 acceptance: conditional writes proven against real blob storage.
 *
 * The unit suite proves our *model* of ETag concurrency. These tests prove the
 * model is what Azure actually implements — that `If-Match` reaches the service
 * as a conditional header, that a mismatch produces a 412, and that our
 * translation of 412 into a domain `concurrency_conflict` is correct.
 *
 * That distinction matters: a fake that agrees with our misunderstanding would
 * pass every unit test while losing data in production.
 */

const ctx = () => createContext('anna', new Date('2026-08-11T09:30:00Z'));

let container: ContainerClient;
let repository: BlobTaskRepository;

beforeAll(() => {
  const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];
  if (connectionString === undefined) {
    throw new Error('Azurite global setup did not run');
  }

  const client = BlobServiceClient.fromConnectionString(connectionString);
  container = client.getContainerClient('tasks');
  repository = new BlobTaskRepository(container);
});

async function seed(title = 'Byt växellåda'): Promise<ETagged<TaskDocument>> {
  return repository.create(createTaskDocument({ title }, ctx()));
}

describe('round trip', () => {
  it('writes and reads a task document', async () => {
    const created = await seed('Kontrollera oljenivå');
    const loaded = await repository.get(created.document.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.document.root.title).toBe('Kontrollera oljenivå');
    expect(loaded?.document.id).toBe(created.document.id);
  });

  it('returns a real ETag from Azure, not a placeholder', async () => {
    const created = await seed();
    expect(created.etag).toMatch(/^"?0x[0-9A-F]+"?$/i);
  });

  it('preserves Swedish characters through the JSON round trip', async () => {
    const created = await seed('Färdigställ växellådan — Åke');
    const loaded = await repository.get(created.document.id);
    expect(loaded?.document.root.title).toBe('Färdigställ växellådan — Åke');
  });

  it('returns null for a task that does not exist', async () => {
    expect(await repository.get('01JGZ0000000000000000ZZZ9')).toBeNull();
  });

  it('refuses to create the same task twice', async () => {
    const created = await seed();
    // ifNoneMatch '*' makes creation conditional too, so a duplicate create
    // fails rather than silently replacing the original.
    await expect(repository.create(created.document)).rejects.toMatchObject({
      code: 'concurrency_conflict',
    });
  });
});

describe('OPTIMISTIC CONCURRENCY — the Phase 2 acceptance criterion', () => {
  it('accepts a write carrying the current ETag', async () => {
    const created = await seed();
    const renamed = {
      ...created.document,
      root: { ...created.document.root, title: 'Uppdaterad' },
    };

    const saved = await repository.replace(renamed, created.etag);
    expect(saved.etag).not.toBe(created.etag);
    expect((await repository.get(created.document.id))?.document.root.title).toBe('Uppdaterad');
  });

  it('rejects a write carrying a stale ETag, translating Azure 412 into a 409', async () => {
    const created = await seed();

    const first = await repository.get(created.document.id);
    const second = await repository.get(created.document.id);
    if (first === null || second === null) throw new Error('fixture failure');

    await repository.replace(
      { ...first.document, root: { ...first.document.root, title: 'Först' } },
      first.etag,
    );

    await expect(
      repository.replace(
        { ...second.document, root: { ...second.document.root, title: 'Sedan' } },
        second.etag,
      ),
    ).rejects.toMatchObject({ code: 'concurrency_conflict' });

    // The winner's write survived intact. This is the "no lost update" claim.
    expect((await repository.get(created.document.id))?.document.root.title).toBe('Först');
  });

  it('produces EXACTLY ONE conflict when two subtask adds race', async () => {
    const created = await seed('Delat arbete');

    // Both clients read the same version, as two people with the task open would.
    const a = await repository.get(created.document.id);
    const b = await repository.get(created.document.id);
    if (a === null || b === null) throw new Error('fixture failure');

    const addSubtask = (entry: ETagged<TaskDocument>, title: string) => {
      const { root } = addChild(entry.document.root, entry.document.root.id, { title }, ctx());
      return repository.replace({ ...entry.document, root }, entry.etag);
    };

    const results = await Promise.allSettled([addSubtask(a, 'Först'), addSubtask(b, 'Sedan')]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'concurrency_conflict',
    });

    // Exactly one subtask landed. Neither write was silently merged away, and
    // the loser got a real error rather than a false success.
    const final = await repository.get(created.document.id);
    expect(final?.document.root.children).toHaveLength(1);
  });

  it('survives a burst of concurrent writers with exactly one winner', async () => {
    const created = await seed('Hög konkurrens');

    const snapshots = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const entry = await repository.get(created.document.id);
        if (entry === null) throw new Error('fixture failure');
        return entry;
      }),
    );

    const results = await Promise.allSettled(
      snapshots.map((entry, index) => {
        const { root } = addChild(
          entry.document.root,
          entry.document.root.id,
          { title: `Deluppgift ${index}` },
          ctx(),
        );
        return repository.replace({ ...entry.document, root }, entry.etag);
      }),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.get(created.document.id))?.document.root.children).toHaveLength(1);
  });

  it('refuses a conditional write with no ETag at all', async () => {
    const created = await seed();
    await expect(repository.replace(created.document, '')).rejects.toMatchObject({
      code: 'precondition_required',
    });
  });

  it('reports a conflict, not a 404, when replacing a task that has been purged', async () => {
    const created = await seed();
    await repository.purge(created.document.id);

    // Azure treats a conditional write against a missing blob as a *precondition
    // failure* (412), not an absence (404) — the ETag cannot match something
    // that is not there. So this surfaces as 409, and the client's existing
    // conflict flow handles it correctly: refetch, discover the 404, tell the
    // user the task is gone. Probing for existence first would add a round trip
    // to every write and race anyway.
    //
    // Only reachable via an admin purge or the Phase-2 cleanup job; no v1 user
    // action hard-deletes (§5).
    await expect(repository.replace(created.document, created.etag)).rejects.toMatchObject({
      code: 'concurrency_conflict',
    });
  });
});

describe('blob metadata drives the list view', () => {
  it('populates summaries from the listing without opening documents', async () => {
    const created = await seed('Med metadata');
    const withChild = addChild(
      created.document.root,
      created.document.root.id,
      { title: 'Del' },
      ctx(),
    );
    await repository.replace({ ...created.document, root: withChild.root }, created.etag);

    const summaries = await repository.list();
    const summary = summaries.find((item) => item.id === created.document.id);

    expect(summary).toBeDefined();
    expect(summary?.title).toBe('Med metadata');
    expect(summary?.childCount).toBe(1);
    expect(summary?.childDoneCount).toBe(0);
  });

  it('round-trips a Swedish title through ASCII-only blob metadata', async () => {
    // Raw non-ASCII in a metadata header is a protocol violation, so the title
    // is base64-encoded. This proves Azure accepts it and it comes back intact.
    const created = await seed('Växellåda på maskin 7 — Åtgärdas');
    const summary = (await repository.list()).find((item) => item.id === created.document.id);
    expect(summary?.title).toBe('Växellåda på maskin 7 — Åtgärdas');
  });

  it('reflects completion in the summary', async () => {
    const created = await seed('Klar uppgift');
    const completed = updateNode(
      created.document.root,
      created.document.root.id,
      (node) => setComplete(node, true, ctx()),
      ctx(),
    );
    await repository.replace({ ...created.document, root: completed }, created.etag);

    const summary = (await repository.list()).find((item) => item.id === created.document.id);
    expect(summary?.isComplete).toBe(true);
    expect(summary?.completedDate).toBe('2026-08-11');
  });

  it('hides soft-deleted tasks using the index tag', async () => {
    const created = await seed('Borttagen');
    await repository.replace(softDeleteDocument(created.document, ctx()), created.etag);

    const visible = await repository.list();
    expect(visible.some((item) => item.id === created.document.id)).toBe(false);

    const all = await repository.list({ includeDeleted: true });
    expect(all.some((item) => item.id === created.document.id)).toBe(true);
  });

  it('ignores the lists aggregate blob that shares the container', async () => {
    // lists.json lives beside the task blobs. Treating it as a task fails
    // validation and takes the whole list view down, which is what happens the
    // moment a user creates their first list.
    const listRepository = new BlobTaskListRepository(container);
    const current = await listRepository.get();
    const { document: withList } = createTaskList(current.document, { name: 'Maskin 9' }, ctx());
    await listRepository.save(withList, current.etag.length === 0 ? null : current.etag);

    const seeded = await seed('Syns i listan');
    const summaries = await repository.list();

    expect(summaries.some((item) => item.id === seeded.document.id)).toBe(true);
    expect(summaries.some((item) => item.id === 'lists')).toBe(false);
  });

  it('filters by user-defined list', async () => {
    const listId = '01JGZ0000000000000000ZZZ2';
    const grouped = await repository.create(
      createTaskDocument({ title: 'I lista', listId }, ctx()),
    );

    const filtered = await repository.list({ listId });
    expect(filtered.map((item) => item.id)).toContain(grouped.document.id);
    expect(filtered.every((item) => item.listId === listId)).toBe(true);
  });
});

describe('the service layer against real storage', () => {
  it('runs the full create → subtask → complete loop', async () => {
    const service = new TaskService(repository);

    const created = await service.create({ title: 'Full slinga' }, ctx());
    const { saved, child } = await service.addChild(
      created.document.id,
      { title: 'Steg 1' },
      created.etag,
      ctx(),
    );
    const done = await service.patchChild(
      created.document.id,
      child.id,
      { isComplete: true },
      saved.etag,
      ctx(),
    );

    expect(getPercent(done.document.root)).toBe(100);
    // 100% is progress, not completion. The parent checkbox is still open.
    expect(isTaskComplete(done.document.root)).toBe(false);

    const reloaded = await service.get(created.document.id);
    expect(getPercent(reloaded.document.root)).toBe(100);
  });

  it('rejects a second write with the same ETag through the service', async () => {
    const service = new TaskService(repository);
    const created = await service.create({ title: 'Konflikt' }, ctx());

    await service.patch(created.document.id, { node: { title: 'A' } }, created.etag, ctx());
    await expect(
      service.patch(created.document.id, { node: { title: 'B' } }, created.etag, ctx()),
    ).rejects.toMatchObject({ code: 'concurrency_conflict' });
  });
});

describe('manual order survives real blob storage', () => {
  /**
   * The unit suite proves the ordering maths. This proves the part that only
   * Azure can answer: that a fractional order survives the metadata round-trip
   * and comes back off a *listing* — which is where the list view reads it
   * from, without opening a single blob.
   */
  it('reorders through the listing, not through the documents', async () => {
    const service = new TaskService(repository);

    const a = await service.create({ title: 'Ordning A' }, ctx());
    const b = await service.create({ title: 'Ordning B' }, ctx());
    const c = await service.create({ title: 'Ordning C' }, ctx());

    /** Positions within the shared container, which holds other tests' tasks. */
    const positions = async () => {
      const listed = await service.list({});
      const index = (id: string) => listed.findIndex((summary) => summary.id === id);
      return [index(a.document.id), index(b.document.id), index(c.document.id)];
    };

    const [beforeA, beforeB, beforeC] = await positions();
    expect(beforeA).toBeLessThan(beforeB as number);
    expect(beforeB).toBeLessThan(beforeC as number);

    const { renumbered } = await service.reorderTasks(
      { movedId: a.document.id, afterId: c.document.id },
      a.etag,
      ctx(),
    );
    expect(renumbered).toBe(0);

    const [afterA, afterB, afterC] = await positions();
    expect(afterB).toBeLessThan(afterC as number);
    expect(afterC).toBeLessThan(afterA as number);

    // The listing's order comes from metadata; the document is the truth behind
    // it. If these disagree the cache has drifted.
    const listed = (await service.list({})).find((summary) => summary.id === a.document.id);
    const document = await service.get(a.document.id);
    expect(listed?.order).toBe(document.document.root.order);
  });

  it('refuses a move on a stale ETag, against real storage', async () => {
    const service = new TaskService(repository);

    const first = await service.create({ title: 'Stale A' }, ctx());
    const second = await service.create({ title: 'Stale B' }, ctx());
    const stale = first.etag;

    await service.patch(first.document.id, { node: { title: 'Stale A²' } }, first.etag, ctx());

    await expect(
      service.reorderTasks(
        { movedId: first.document.id, afterId: second.document.id },
        stale,
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'concurrency_conflict' });
  });
});

describe('the lists aggregate', () => {
  it('creates on first save and enforces the ETag afterwards', async () => {
    const listRepository = new BlobTaskListRepository(container);

    // Deliberately tolerant of a container another test already wrote to: the
    // claim under test is create-then-enforce-ETag, not an empty start.
    const initial = await listRepository.get();
    const isFirstWrite = initial.etag.length === 0;

    const { document } = createTaskList(
      isFirstWrite ? createTaskListsDocument() : initial.document,
      { name: 'Maskin 7' },
      ctx(),
    );
    const saved = await listRepository.save(document, isFirstWrite ? null : initial.etag);
    expect(saved.etag).not.toBe('');

    const loaded = await listRepository.get();
    expect(loaded.document.lists.some((list) => list.name === 'Maskin 7')).toBe(true);

    // A stale ETag must lose, exactly as with tasks.
    const stale = createTaskList(loaded.document, { name: 'Andra' }, ctx());
    await listRepository.save(stale.document, loaded.etag);
    await expect(listRepository.save(stale.document, loaded.etag)).rejects.toMatchObject({
      code: 'concurrency_conflict',
    });
  });
});
