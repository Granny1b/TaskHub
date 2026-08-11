import { describe, expect, it, vi } from 'vitest';
import { EventBus, noopEventHandler, type DomainEvent } from './events.js';

const event: DomainEvent = {
  type: 'TaskCreated',
  at: '2026-08-11T09:30:00.000Z',
  actor: 'anna',
  taskId: '01JGZ0000000000000000ZZZ1',
};

describe('EventBus', () => {
  it('delivers to every subscriber', () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe(first);
    bus.subscribe(second);
    bus.publish(event);

    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);

    unsubscribe();
    bus.publish(event);

    expect(handler).not.toHaveBeenCalled();
    expect(bus.handlerCount).toBe(0);
  });

  it('contains a throwing handler so one bad subscriber cannot fail the mutation', () => {
    const onError = vi.fn();
    const bus = new EventBus(onError);
    const healthy = vi.fn();

    bus.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    bus.subscribe(healthy);

    expect(() => bus.publish(event)).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('contains a rejected async handler too', async () => {
    const onError = vi.fn();
    const bus = new EventBus(onError);

    bus.subscribe(async () => {
      throw new Error('async subscriber exploded');
    });

    expect(() => bus.publish(event)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('has no subscribers by default — v1 emits into a void on purpose', () => {
    expect(new EventBus().handlerCount).toBe(0);
  });

  it('ships a no-op handler for v1 wiring', () => {
    expect(() => noopEventHandler(event)).not.toThrow();
  });
});
