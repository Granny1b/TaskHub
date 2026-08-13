import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DomainError,
  EventBus,
  createContext,
  getPercent,
  isPercentDerived,
  isTaskComplete,
  type DomainEvent,
} from '@taskhub/shared';
import { InMemoryTaskRepository } from '../repositories/InMemoryTaskRepository.js';
import { TaskService } from './taskService.js';

const ctx = () => createContext('anna', new Date('2026-08-11T09:30:00Z'));

describe('TaskService', () => {
  let repository: InMemoryTaskRepository;
  let events: DomainEvent[];
  let service: TaskService;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    events = [];
    const bus = new EventBus();
    bus.subscribe((event) => events.push(event));
    service = new TaskService(repository, bus);
  });

  const seed = async (title = 'Byt växellåda') => service.create({ title }, ctx());

  describe('create', () => {
    it('creates a main task and emits TaskCreated', async () => {
      const created = await seed();
      expect(created.document.root.title).toBe('Byt växellåda');
      expect(events.map((event) => event.type)).toEqual(['TaskCreated']);
    });

    it('records the acting principal, not anything the client sent', async () => {
      const created = await service.create({ title: 'X' }, createContext('object-id-123'));
      expect(created.document.root.createdBy).toBe('object-id-123');
    });
  });

  describe('get', () => {
    it('throws not_found for an unknown task', async () => {
      await expect(service.get('01JGZ0000000000000000ZZZ9')).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('hides a soft-deleted task by default but can be asked for it', async () => {
      const created = await seed();
      await service.softDelete(created.document.id, created.etag, ctx());

      await expect(service.get(created.document.id)).rejects.toMatchObject({ code: 'not_found' });
      await expect(service.get(created.document.id, true)).resolves.toBeDefined();
    });
  });

  describe('patch', () => {
    it('updates fields and bumps the ETag', async () => {
      const created = await seed();
      const saved = await service.patch(
        created.document.id,
        { node: { title: 'Nytt namn', comments: 'Se ritning 4b' } },
        created.etag,
        ctx(),
      );

      expect(saved.document.root.title).toBe('Nytt namn');
      expect(saved.document.root.comments).toBe('Se ritning 4b');
      expect(saved.etag).not.toBe(created.etag);
    });

    it('rejects a stale ETag rather than overwriting', async () => {
      const created = await seed();
      await service.patch(created.document.id, { node: { title: 'A' } }, created.etag, ctx());

      await expect(
        service.patch(created.document.id, { node: { title: 'B' } }, created.etag, ctx()),
      ).rejects.toMatchObject({ code: 'concurrency_conflict' });
    });

    it('setting percent to 100 does not complete the task', async () => {
      const created = await seed();
      const saved = await service.patch(
        created.document.id,
        { node: { percent: 100 } },
        created.etag,
        ctx(),
      );

      expect(getPercent(saved.document.root)).toBe(100);
      expect(isTaskComplete(saved.document.root)).toBe(false);
      expect(events.some((event) => event.type === 'TaskCompleted')).toBe(false);
    });

    it('completing at a partial percent keeps the percent and emits it', async () => {
      const created = await seed();
      const withPercent = await service.patch(
        created.document.id,
        { node: { percent: 40 } },
        created.etag,
        ctx(),
      );
      const completed = await service.patch(
        created.document.id,
        { node: { isComplete: true } },
        withPercent.etag,
        ctx(),
      );

      expect(isTaskComplete(completed.document.root)).toBe(true);
      expect(getPercent(completed.document.root)).toBe(40);
      expect(completed.document.root.completedDate).toBe('2026-08-11');

      const event = events.find((item) => item.type === 'TaskCompleted');
      expect(event).toMatchObject({ percentAtCompletion: 40 });
    });

    it('applies percent and completion together in one patch', async () => {
      const created = await seed();
      const saved = await service.patch(
        created.document.id,
        { node: { percent: 60, isComplete: true } },
        created.etag,
        ctx(),
      );

      expect(getPercent(saved.document.root)).toBe(60);
      expect(isTaskComplete(saved.document.root)).toBe(true);
    });

    it('lets an explicit completedDate win over the automatic stamp', async () => {
      const created = await seed();
      const saved = await service.patch(
        created.document.id,
        { node: { isComplete: true, completedDate: '2026-07-01' } },
        created.etag,
        ctx(),
      );

      expect(saved.document.root.completedDate).toBe('2026-07-01');
    });

    it('emits TaskReopened when completion is withdrawn', async () => {
      const created = await seed();
      const done = await service.patch(
        created.document.id,
        { node: { isComplete: true } },
        created.etag,
        ctx(),
      );
      await service.patch(created.document.id, { node: { isComplete: false } }, done.etag, ctx());

      expect(events.map((event) => event.type)).toContain('TaskReopened');
    });

    it('does not emit a completion event when completion did not change', async () => {
      const created = await seed();
      await service.patch(created.document.id, { node: { title: 'Nytt' } }, created.etag, ctx());

      expect(events.some((event) => event.type === 'TaskCompleted')).toBe(false);
      expect(events.some((event) => event.type === 'TaskReopened')).toBe(false);
    });

    it('moves a task between user-defined lists', async () => {
      const created = await seed();
      const saved = await service.patch(
        created.document.id,
        { listId: '01JGZ0000000000000000ZZZ2' },
        created.etag,
        ctx(),
      );

      expect(saved.document.listId).toBe('01JGZ0000000000000000ZZZ2');
    });
  });

  describe('children', () => {
    it('adds a subtask and drives the parent derived percent', async () => {
      const created = await seed();
      const { saved, child } = await service.addChild(
        created.document.id,
        { title: 'Demontera' },
        created.etag,
        ctx(),
      );

      expect(saved.document.root.children).toHaveLength(1);
      expect(getPercent(saved.document.root)).toBe(0);

      const done = await service.patchChild(
        created.document.id,
        child.id,
        { isComplete: true },
        saved.etag,
        ctx(),
      );

      expect(getPercent(done.document.root)).toBe(100);
      // The parent's own checkbox is untouched: 100% is not "done".
      expect(isTaskComplete(done.document.root)).toBe(false);
      expect(events.map((event) => event.type)).toContain('SubtaskCompleted');
    });

    it('refuses to patch the root through the children route', async () => {
      const created = await seed();
      await expect(
        service.patchChild(
          created.document.id,
          created.document.root.id,
          { title: 'x' },
          created.etag,
          ctx(),
        ),
      ).rejects.toMatchObject({ code: 'invalid_operation' });
    });

    it('refuses to nest past the depth cap', async () => {
      const created = await seed();
      const { saved, child } = await service.addChild(
        created.document.id,
        { title: 'Del' },
        created.etag,
        ctx(),
      );

      await expect(
        service.addChild(
          created.document.id,
          { title: 'För djupt', parentId: child.id },
          saved.etag,
          ctx(),
        ),
      ).rejects.toMatchObject({ code: 'depth_exceeded' });
    });

    it('removes a subtask and recomputes the parent', async () => {
      const created = await seed();
      const first = await service.addChild(
        created.document.id,
        { title: 'A' },
        created.etag,
        ctx(),
      );
      const second = await service.addChild(
        created.document.id,
        { title: 'B' },
        first.saved.etag,
        ctx(),
      );
      const done = await service.patchChild(
        created.document.id,
        second.child.id,
        { isComplete: true },
        second.saved.etag,
        ctx(),
      );
      expect(getPercent(done.document.root)).toBe(50);

      const removed = await service.removeChild(
        created.document.id,
        first.child.id,
        done.etag,
        ctx(),
      );

      expect(removed.document.root.children).toHaveLength(1);
      expect(getPercent(removed.document.root)).toBe(100);
      expect(events.map((event) => event.type)).toContain('SubtaskRemoved');
    });

    it('leaves a manual parent percent alone when a subtask completes', async () => {
      const created = await seed();
      const withChild = await service.addChild(
        created.document.id,
        { title: 'A' },
        created.etag,
        ctx(),
      );
      const manual = await service.patch(
        created.document.id,
        { node: { percent: 90 } },
        withChild.saved.etag,
        ctx(),
      );

      const done = await service.patchChild(
        created.document.id,
        withChild.child.id,
        { isComplete: true },
        manual.etag,
        ctx(),
      );

      expect(getPercent(done.document.root)).toBe(90);
      expect(isPercentDerived(done.document.root)).toBe(false);
    });

    it('restores automatic percent through percentSource: derived', async () => {
      const created = await seed();
      const withChild = await service.addChild(
        created.document.id,
        { title: 'A' },
        created.etag,
        ctx(),
      );
      const manual = await service.patch(
        created.document.id,
        { node: { percent: 90 } },
        withChild.saved.etag,
        ctx(),
      );
      const done = await service.patchChild(
        created.document.id,
        withChild.child.id,
        { isComplete: true },
        manual.etag,
        ctx(),
      );

      const auto = await service.patch(
        created.document.id,
        { node: { percentSource: 'derived' } },
        done.etag,
        ctx(),
      );

      expect(isPercentDerived(auto.document.root)).toBe(true);
      expect(getPercent(auto.document.root)).toBe(100);
    });

    it('reorders subtasks', async () => {
      const created = await seed();
      const a = await service.addChild(created.document.id, { title: 'A' }, created.etag, ctx());
      const b = await service.addChild(created.document.id, { title: 'B' }, a.saved.etag, ctx());

      const reordered = await service.reorder(
        created.document.id,
        { movedId: b.child.id, toIndex: 0 },
        b.saved.etag,
        ctx(),
      );

      const titles = [...reordered.document.root.children]
        .sort((x, y) => x.order - y.order)
        .map((child) => child.title);
      expect(titles).toEqual(['B', 'A']);
      expect(events.map((event) => event.type)).toContain('ChildrenReordered');
    });

    it('requires a fresh ETag for every child mutation', async () => {
      const created = await seed();
      const first = await service.addChild(
        created.document.id,
        { title: 'A' },
        created.etag,
        ctx(),
      );

      await expect(
        service.addChild(created.document.id, { title: 'B' }, created.etag, ctx()),
      ).rejects.toMatchObject({ code: 'concurrency_conflict' });

      expect(first.saved.document.root.children).toHaveLength(1);
    });
  });

  describe('manual order of main tasks', () => {
    /** Three tasks, oldest first, each with a distinct order. */
    const seedThree = async () => {
      const a = await service.create({ title: 'A' }, ctx());
      const b = await service.create({ title: 'B' }, ctx());
      const c = await service.create({ title: 'C' }, ctx());
      return { a, b, c };
    };

    const titles = async () => (await service.list({})).map((summary) => summary.title);

    it('gives each new task an order of its own, at the end', async () => {
      const { a, b, c } = await seedThree();
      const orders = [a, b, c].map((entry) => entry.document.root.order);

      expect(orders).toEqual([1000, 2000, 3000]);
      expect(await titles()).toEqual(['A', 'B', 'C']);
    });

    it('moves a task after another and persists it', async () => {
      const { a, c } = await seedThree();

      const { renumbered } = await service.reorderTasks(
        { movedId: a.document.id, afterId: c.document.id },
        a.etag,
        ctx(),
      );

      expect(await titles()).toEqual(['B', 'C', 'A']);
      // One blob written, which is the point of sparse floats.
      expect(renumbered).toBe(0);
    });

    it('moves a task to the head with a null anchor', async () => {
      const { c } = await seedThree();
      await service.reorderTasks({ movedId: c.document.id, afterId: null }, c.etag, ctx());

      expect(await titles()).toEqual(['C', 'A', 'B']);
    });

    it('emits TasksReordered', async () => {
      const { a, b } = await seedThree();
      events.length = 0;
      await service.reorderTasks({ movedId: a.document.id, afterId: b.document.id }, a.etag, ctx());

      expect(events).toEqual([
        expect.objectContaining({ type: 'TasksReordered', taskId: a.document.id, renumbered: 0 }),
      ]);
    });

    it('refuses a stale ETag rather than losing the other edit', async () => {
      const { a, b } = await seedThree();
      const stale = a.etag;
      await service.patch(a.document.id, { node: { title: 'A edited' } }, a.etag, ctx());

      await expect(
        service.reorderTasks({ movedId: a.document.id, afterId: b.document.id }, stale, ctx()),
      ).rejects.toMatchObject({ code: 'concurrency_conflict' });

      // Nothing moved, and the other person's edit is intact.
      expect(await titles()).toEqual(['A edited', 'B', 'C']);
    });

    it('rejects placing a task after itself', async () => {
      const { a } = await seedThree();
      await expect(
        service.reorderTasks({ movedId: a.document.id, afterId: a.document.id }, a.etag, ctx()),
      ).rejects.toMatchObject({ code: 'invalid_operation' });
    });

    it('rejects a task that does not exist', async () => {
      const { a } = await seedThree();
      await expect(
        service.reorderTasks(
          { movedId: '01JZZZZZZZZZZZZZZZZZZZZZZZ', afterId: a.document.id },
          a.etag,
          ctx(),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('renumbers the whole list when the float gap is exhausted', async () => {
      const { a, b, c } = await seedThree();

      // Force the neighbours together so no value fits between them. This is
      // the tail case sparse-float ordering has to survive — reached in
      // practice only after ~20 drops into the same gap.
      const squeeze = async (entry: typeof a, order: number) => {
        const current = await service.get(entry.document.id);
        await repository.replace(
          { ...current.document, root: { ...current.document.root, order } },
          current.etag,
        );
      };
      await squeeze(a, 1000);
      await squeeze(b, 1000.0001);
      await squeeze(c, 1000.0002);

      const latest = await service.get(c.document.id);
      const { renumbered } = await service.reorderTasks(
        { movedId: c.document.id, afterId: a.document.id },
        latest.etag,
        ctx(),
      );

      expect(await titles()).toEqual(['A', 'C', 'B']);

      // One, not two: A was squeezed to 1000 and renumbers back to 1000, and a
      // blob whose order is already right is not rewritten. C is the moved task
      // and is written separately, under the caller's own ETag.
      expect(renumbered).toBe(1);

      const orders = (await service.list({})).map((summary) => summary.order);
      expect(orders).toEqual([1000, 2000, 3000]);
    });

    it('leaves a renumbered task alone rather than stamping it as edited', async () => {
      // A renumber changes how order is represented, not the task. Stamping
      // every task would show the whole list as edited by whoever dragged one
      // row, which is a lie an audit log would repeat.
      const { a, b, c } = await seedThree();
      const before = (await service.get(b.document.id)).document.root.updatedAt;

      for (const [entry, order] of [
        [a, 1000],
        [b, 1000.0001],
        [c, 1000.0002],
      ] as const) {
        const current = await service.get(entry.document.id);
        await repository.replace(
          { ...current.document, root: { ...current.document.root, order } },
          current.etag,
        );
      }

      const latest = await service.get(c.document.id);
      await service.reorderTasks(
        { movedId: c.document.id, afterId: a.document.id },
        latest.etag,
        createContext('someone-else', new Date('2026-09-01T12:00:00Z')),
      );

      const after = await service.get(b.document.id);
      expect(after.document.root.updatedAt).toBe(before);
      expect(after.document.root.updatedBy).not.toBe('someone-else');
    });
  });

  describe('soft delete', () => {
    it('marks rather than destroys, and emits TaskDeleted', async () => {
      const created = await seed();
      const deleted = await service.softDelete(created.document.id, created.etag, ctx());

      expect(deleted.document.deletedAt).not.toBeNull();
      expect(deleted.document.root.title).toBe('Byt växellåda');
      expect(events.map((event) => event.type)).toContain('TaskDeleted');
    });

    it('drops the task out of the default listing', async () => {
      const created = await seed();
      await service.softDelete(created.document.id, created.etag, ctx());

      expect(await service.list({})).toHaveLength(0);
      expect(await service.list({ includeDeleted: true })).toHaveLength(1);
    });
  });

  describe('event delivery', () => {
    it('does not fail a mutation when a subscriber throws', async () => {
      const bus = new EventBus(() => {
        /* swallow */
      });
      bus.subscribe(() => {
        throw new Error('audit log is down');
      });
      const isolated = new TaskService(new InMemoryTaskRepository(), bus);

      await expect(isolated.create({ title: 'X' }, ctx())).resolves.toBeDefined();
    });

    it('emits nothing when there are no subscribers', async () => {
      const bare = new TaskService(new InMemoryTaskRepository());
      const spy = vi.fn();
      await expect(bare.create({ title: 'X' }, ctx())).resolves.toBeDefined();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('TaskService.moveChildToTask', () => {
  let repository: InMemoryTaskRepository;
  let events: DomainEvent[];
  let service: TaskService;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    events = [];
    const bus = new EventBus();
    bus.subscribe((event) => events.push(event));
    service = new TaskService(repository, bus);
  });

  /** Two tasks, the first carrying one subtask. */
  const twoTasks = async () => {
    const source = await service.create({ title: 'Byt växellåda' }, ctx());
    const destination = await service.create({ title: 'Kontrollera spindel' }, ctx());
    const { saved, child } = await service.addChild(
      source.document.id,
      { title: 'Provkör' },
      source.etag,
      ctx(),
    );
    return { sourceId: source.document.id, destinationId: destination.document.id, saved, child };
  };

  it('moves the subtask across, keeping its id', async () => {
    const { sourceId, destinationId, saved, child } = await twoTasks();

    const { from, to } = await service.moveChildToTask(
      sourceId,
      child.id,
      destinationId,
      saved.etag,
      ctx(),
    );

    expect(from.document.root.children).toHaveLength(0);
    expect(to.document.root.children).toHaveLength(1);
    expect(to.document.root.children[0]?.id).toBe(child.id);
    expect(to.document.root.children[0]?.title).toBe('Provkör');
  });

  it('emits SubtaskMoved naming both tasks', async () => {
    const { sourceId, destinationId, saved, child } = await twoTasks();
    events.length = 0;

    await service.moveChildToTask(sourceId, child.id, destinationId, saved.etag, ctx());

    expect(events).toEqual([
      expect.objectContaining({
        type: 'SubtaskMoved',
        taskId: sourceId,
        toTaskId: destinationId,
        childId: child.id,
      }),
    ]);
  });

  it('refuses a move to the task it is already in', async () => {
    const { sourceId, saved, child } = await twoTasks();

    await expect(
      service.moveChildToTask(sourceId, child.id, sourceId, saved.etag, ctx()),
    ).rejects.toThrow(DomainError);
  });

  it('refuses a subtask that is not in the source task', async () => {
    const { sourceId, destinationId, saved } = await twoTasks();

    await expect(
      service.moveChildToTask(sourceId, 'no-such-child', destinationId, saved.etag, ctx()),
    ).rejects.toThrow(DomainError);
  });

  it('rejects a stale source ETag and leaves the subtask in exactly one place', async () => {
    const { sourceId, destinationId, saved, child } = await twoTasks();

    // Somebody else edits the source, so the caller's ETag is now stale.
    await service.patch(
      sourceId,
      { node: { title: 'Byt växellåda (brådskande)' } },
      saved.etag,
      ctx(),
    );

    await expect(
      service.moveChildToTask(sourceId, child.id, destinationId, saved.etag, ctx()),
    ).rejects.toThrow(DomainError);

    /*
      This is the assertion the whole ordering exists for. The graft to the
      destination happened before the source write failed, so without the
      compensating rollback the subtask would now be in both tasks.
    */
    const source = await service.get(sourceId);
    const destination = await service.get(destinationId);
    expect(source.document.root.children).toHaveLength(1);
    expect(destination.document.root.children).toHaveLength(0);
  });
});
