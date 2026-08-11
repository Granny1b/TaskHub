/**
 * Domain events (§9.4).
 *
 * Every mutation emits a typed event to an in-process bus. In v1 the only
 * subscriber is a no-op. This is deliberately built now because retrofitting it
 * later means touching every mutation site — the expensive kind of change.
 *
 * Phase 2 subscribes an audit-log writer here. Notifications, when they exist,
 * subscribe here too. Neither requires editing a single mutation.
 */

export interface DomainEventBase {
  readonly at: string;
  readonly actor: string;
  readonly taskId: string;
}

export type DomainEvent =
  | ({ readonly type: 'TaskCreated' } & DomainEventBase)
  | ({ readonly type: 'TaskUpdated' } & DomainEventBase)
  | ({ readonly type: 'TaskDeleted' } & DomainEventBase)
  | ({ readonly type: 'TaskCompleted'; readonly percentAtCompletion: number } & DomainEventBase)
  | ({ readonly type: 'TaskReopened' } & DomainEventBase)
  | ({ readonly type: 'SubtaskAdded'; readonly childId: string } & DomainEventBase)
  | ({ readonly type: 'SubtaskUpdated'; readonly childId: string } & DomainEventBase)
  | ({ readonly type: 'SubtaskRemoved'; readonly childId: string } & DomainEventBase)
  | ({ readonly type: 'SubtaskCompleted'; readonly childId: string } & DomainEventBase)
  | ({ readonly type: 'SubtaskReopened'; readonly childId: string } & DomainEventBase)
  | ({ readonly type: 'ChildrenReordered'; readonly parentId: string } & DomainEventBase)
  | ({ readonly type: 'AttachmentAdded'; readonly attachmentId: string } & DomainEventBase)
  | ({ readonly type: 'AttachmentRemoved'; readonly attachmentId: string } & DomainEventBase)
  | {
      readonly type: 'TaskListCreated';
      readonly at: string;
      readonly actor: string;
      readonly listId: string;
    }
  | {
      readonly type: 'TaskListRenamed';
      readonly at: string;
      readonly actor: string;
      readonly listId: string;
    }
  | {
      readonly type: 'TaskListDeleted';
      readonly at: string;
      readonly actor: string;
      readonly listId: string;
    }
  | { readonly type: 'TaskListsReordered'; readonly at: string; readonly actor: string };

export type DomainEventType = DomainEvent['type'];

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface Unsubscribe {
  (): void;
}

/**
 * Minimal in-process bus.
 *
 * Handler failures are contained: one bad subscriber must never fail the
 * mutation that emitted the event, because in v1 nothing subscribed here is
 * load-bearing. When something load-bearing subscribes, that is the moment to
 * move to a durable queue — not to make this throw.
 */
export class EventBus {
  private readonly handlers = new Set<EventHandler>();
  private readonly onHandlerError: (error: unknown, event: DomainEvent) => void;

  constructor(onHandlerError?: (error: unknown, event: DomainEvent) => void) {
    this.onHandlerError =
      onHandlerError ??
      ((error, event) => {
        console.error(`Event handler failed for ${event.type}`, error);
      });
  }

  subscribe(handler: EventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(event: DomainEvent): void {
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.onHandlerError(error, event));
        }
      } catch (error) {
        this.onHandlerError(error, event);
      }
    }
  }

  get handlerCount(): number {
    return this.handlers.size;
  }
}

/** The v1 default: events are emitted and nothing listens. */
export const noopEventHandler: EventHandler = () => {
  /* Phase 2 replaces this with an audit-log subscriber. */
};
