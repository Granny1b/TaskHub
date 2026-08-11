# Architecture

TaskHub is a multi-user task manager for Modig Machine Tool. A user creates a
**main task**, adds **subtasks**, marks things complete, and attaches files to
either. It runs on Azure Static Web Apps (Free) with Blob Storage and no
database, and is built so a database can be introduced later without rewriting
the domain or the UI.

The governing principle: **prefer boring, explicit, well-seamed code**. Every
decision below is written down in `DECISIONS.md` with its consequences.

---

## Shape

```
┌──────────────────────────────────────────────────────────┐
│  Azure Static Web Apps (Free)                            │
│                                                          │
│  /web     React 19 + TS + Vite + Tailwind v4  (static)   │
│  /api     SWA-managed Azure Functions v4 (Node 20)       │
│  /shared  Zod schemas + domain, imported by both         │
└───────────────────────┬──────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │ JSON aggregates + SAS grants  │
        ▼                               ▼
┌────────────────────┐        ┌──────────────────────┐
│ Blob: tasks        │        │ Blob: attachments    │
│ {taskId}.json      │        │ browser uploads      │
│ lists.json         │        │ direct via SAS       │
└────────────────────┘        └──────────────────────┘
```

## Layers, and what each may import

| Layer                  | May import                      | May **not** import               |
| ---------------------- | ------------------------------- | -------------------------------- |
| `shared/src/domain`    | Zod, `ulid`                     | Azure SDK, Node built-ins, React |
| `api/src/domain`       | `@taskhub/shared`               | Azure SDK                        |
| `api/src/functions`    | `@taskhub/shared`, repositories | Azure SDK (storage)              |
| `api/src/repositories` | Azure SDK, `@taskhub/shared`    | —                                |
| `web/src/components`   | `@taskhub/shared`, React        | anything in `web/src/features`   |

**These are lint errors, not conventions.** `eslint.config.js` encodes each row.
The most important — no Azure SDK above the repository layer — is what makes the
future database migration a one-file change (ADR-0003).

`/shared` is bundled into the browser, so it must stay platform-neutral. That is
why `metadata.ts` uses `TextEncoder`/`btoa` rather than `Buffer`, and why the
Node-built-in ban exists.

## The domain layer

Everything that decides _what is true_ lives in `shared/src/domain`. It is pure:
no I/O, no clock reads, no global state. Time enters through `MutationContext`,
which carries `actor`, `now` (an instant) and `today` (a calendar date in
`Europe/Stockholm`) — separate values because they answer different questions,
and because stamping a completion date from UTC at 23:30 Swedish time records
the wrong day.

| Module           | Responsibility                                                                  |
| ---------------- | ------------------------------------------------------------------------------- |
| `schemas.ts`     | Zod schemas — the single source of truth. Types via `z.infer`.                  |
| `completion.ts`  | Every rule about "done" and percent. Nothing else reads the `Completion` union. |
| `tree.ts`        | Immutable tree operations, depth-capped by config.                              |
| `ordering.ts`    | Sparse-float ordering and renormalisation. All ordering maths.                  |
| `migrations.ts`  | Versioned document evolution; `changeCompletionKind`.                           |
| `metadata.ts`    | Projection to and from blob metadata and index tags.                            |
| `documents.ts`   | Aggregate construction, summary projection, soft delete.                        |
| `taskLists.ts`   | The user-definable grouping level.                                              |
| `attachments.ts` | Path convention, filename sanitisation, upload gates.                           |
| `events.ts`      | Typed domain events on an in-process bus.                                       |

### Manual order, in one paragraph

Everything orderable carries a sparse float, so moving one item writes one
number instead of renumbering its neighbours. Subtasks and the user-defined
lists each live inside a single document, so a move there is one conditional
write and cannot half-apply.
Main tasks are separate blobs: `root.order` is the truth, `taskorder` in the blob
metadata is what the listing sorts by, and the total order is
`compareByOrderThenId` — the id tie-break is what keeps tasks written before
ordering existed in the order they always had. The one case that spans blobs is
a renumber, when the float gap between two neighbours is exhausted; it is best
effort and reports how many tasks it rewrote. ADR-0034 has the reasoning.

### The completion model, in one paragraph

The checkbox is the sole authority on "done"; `isTaskComplete()` is the only
function that answers the question. Percent is progress reporting. A main task
can be complete at 40%, and unticking restores 40% rather than 100. Reaching
100% never auto-ticks anything — reaching 100% and declaring something finished
are different acts, and this is a quality record. Completing a parent does not
cascade to children; their real state stays visible on expand. When a main task
has children and its percent is `derived`, the percent mirrors the child ratio;
editing it by hand flips it to `manual` permanently until the user explicitly
asks for auto again.

Those rules are executable in `completion.test.ts`, where the four invariants
the build order names are each their own `describe` block.

## Concurrency

Optimistic, via blob ETag, and treated as a correctness requirement rather than
a nicety — two people editing subtasks of the same task is the expected case
(ADR-0001 makes them share a blob).

- `GET` returns the ETag.
- Every mutation requires `If-Match`; a request without one is `428`.
- The repository passes it to Azure as a conditional write. Azure's `412`
  becomes a `409` with `{ type: 'concurrency_conflict' }` so the client can
  react specifically rather than parse a message.
- `InMemoryTaskRepository` implements the same semantics, so unit tests exercise
  the real contract. A test proves two concurrent subtask adds produce exactly
  one conflict and no lost update.

## Storage layout

```
Container: tasks (private)
  {taskId}.json      TaskDocument — the whole aggregate
  lists.json         all user-defined lists (ADR-0004)

  Blob metadata (list-view cache, ASCII, base64 for text):
    titleb64, taskdate, iscomplete, percent, completeddate,
    childcount, childdonecount, attachmentcount, updatedat,
    listid, taskorder, schemaversion

  Blob index tags (server-side filtering, 4 of 10 used):
    isComplete, date, listId, deleted

Container: attachments (private)
  {taskId}/{attachmentId}/{sanitizedFileName}
  {taskId}/{attachmentId}/thumb.jpg
```

Attachments are keyed by task so deleting a task can prefix-delete its files.
Nothing is ever hard-deleted on a user action in v1 — soft delete sets
`deletedAt` and the `deleted` tag.

**Nothing personal is stored server-side.** How someone likes to see their work
— where subtasks appear, row density, whether the Kommentarer column is shown,
column widths, theme, language — lives in `localStorage`, never on the task
document (ADR-0033). Two people looking at the same task are allowed to disagree
about its presentation, and a preference change should not be a blob write with
an ETag and a possible conflict.

## Extension points

These exist so future features do not require touching existing code:

1. **`ITaskRepository`** — the database seam (ADR-0003).
2. **`custom: Record<string, unknown>`** on every node, plus `fieldRegistry` to
   drive rendering. Adding a field is a registry entry, not a form rewrite.
   Empty in v1 by design: priority, assignee and labels are explicitly not v1
   fields, so the default UI stays as clean as the source spreadsheet.
3. **`migrate()`** — versioned document evolution, shipped working in v1 with an
   identity migration and tests that prove multi-step chaining.
4. **Domain events** — every mutation emits a typed event to an `EventBus` whose
   only v1 subscriber is a no-op. Built now because retrofitting it means
   touching every mutation.
5. **Feature flags** — `shared/src/config/features.ts`. Everything out of scope
   has a flag defaulting to false; a test asserts none is enabled.
6. **View registry** — one entry (`list`) in v1; board and calendar become
   registry entries rather than conditionals inside the list component.

## Scale limits, stated honestly

- **Listing-driven list view: good to ~1,000 tasks.** Past that, add a
  projection blob rebuilt out-of-band. `// SCALE:` comments mark the swap point.
  Note that SWA-managed Functions are HTTP-only, so that job needs a separate
  Functions app or a scheduled action (`VERIFICATION.md` §2).
- **Search is a title substring match performed after listing.** Adequate for
  hundreds of tasks; it is not full-text and does not look inside attachments.
- **`lists.json` is a single blob.** Fine for the tens of lists a person will
  create; it is not a general-purpose collection.

## What is deliberately not here

Real-time collaboration, notifications, Gantt/calendar views, time tracking,
comments/mentions, recurring tasks, Monitor G5 integration, and full-text search
across attachments. The seams are designed; none is built.
