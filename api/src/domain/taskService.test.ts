import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
