# Architecture decision record

Every non-obvious choice gets a dated entry: context, decision, consequences.
Entries are append-only. Superseding an entry means adding a new one that says
so, not editing history.

---

## ADR-0001 — One blob per main task, containing its subtasks

**Date:** 2026-08-11 · **Status:** accepted · **Source:** spec §3

**Context.** A main task and its subtasks are edited together constantly. Any
split across storage units raises the question of how to keep them consistent.

**Decision.** The main task and its subtasks are a single aggregate, stored as
one blob (`{taskId}.json`) and guarded by one ETag.

**Consequences.**

- Subtask edits are atomic with zero transaction machinery.
- Two people editing different subtasks of the _same_ task collide. That is
  handled by optimistic concurrency (ADR-0003 and §7), not avoided.
- A task with a pathological number of subtasks becomes a large blob. The depth
  cap of 2 makes this a non-issue at any realistic size.

**Rejected:** a blob per subtask (needs cross-blob transactions to keep parent
counts correct); one giant `tasks.json` (every write collides).

---

## ADR-0002 — No index blob; the list view is built from blob listing + metadata

**Date:** 2026-08-11 · **Status:** accepted · **Source:** spec §3

**Context.** The list view needs title, date, status, counts and completion for
every task. Opening every blob to render a list is unacceptable; a shared index
blob rewritten on every save is a write hotspot and a second thing to keep
consistent.

**Decision.** Denormalise the list-view fields into **blob metadata**, which
Azure returns inline on a listing call. One request populates the whole panel.
Metadata is a disposable cache; truth is always the JSON document.

**Consequences.**

- One request for the list view, no index to corrupt.
- Metadata values must be header-safe ASCII — see ADR-0013.
- Good to roughly 1,000 tasks. Past that, a projection blob rebuilt by a
  queue-triggered function. A `// SCALE:` comment marks the swap point in
  `shared/src/domain/metadata.ts` and `BlobTaskRepository.list`.
- Note (from `VERIFICATION.md` §2): SWA-managed Functions are HTTP-only, so
  that future queue trigger needs a separate Functions app or a scheduled
  GitHub Action.
- If metadata is missing or unreadable, `list()` falls back to opening that one
  document rather than dropping the task out of the user's view.

---

## ADR-0003 — All storage access goes through `ITaskRepository`

**Date:** 2026-08-11 · **Status:** accepted · **Source:** spec §3

**Context.** v1 is blob-only, but a real database is an explicit future step.
The migration must not require rewriting the domain or the HTTP layer.

**Decision.** The API layer never imports `@azure/storage-blob`. It depends on
`ITaskRepository` / `ITaskListRepository`. Implementations live only in
`api/src/repositories/` and the client factory in `api/src/lib/`.

**Consequences.**

- A future `SqlTaskRepository` is a new file plus one line in
  `api/src/repositories/index.ts`.
- **Enforced mechanically, not by review.** `eslint.config.js` bans `@azure/*`
  imports in `api/src/domain/`, `api/src/functions/` and all of `/shared`. The
  spec asked for this to be enforced in review; a lint rule outlives reviewers.
- `InMemoryTaskRepository` models the same ETag semantics, so tests exercise the
  concurrency contract rather than a simplified fake.

---

## ADR-0004 — All user-defined lists live in a single blob

**Date:** 2026-08-11 · **Status:** accepted · **Supersedes nothing; extends §3**

**Context.** The user asked for a grouping level above the main task, with the
ability to create as many named lists as they like ("Maskin 7", "Kundprojekt
Volvo"). The spec's §17.4 warned this changes the blob layout.

**Decision.** A `TaskList` entity, and **all** lists in one blob (`lists.json`)
under one ETag — the opposite of the per-task rule in ADR-0001.

**Why the inconsistency is correct.** The two rules follow the same principle:
things read together, written together and _reordered_ together belong in one
aggregate. Reordering lists across separate blobs would need exactly the
cross-blob transaction that ADR-0001 rejected for subtasks. The write-hotspot
objection that ruled out a shared task index does not apply, because list writes
are rare — creating or renaming a list, not saving a task.

**Consequences.**

- Atomic reorder, one GET for the whole left panel.
- Two admins renaming lists simultaneously produces a 409. Correct behaviour,
  and rare enough not to matter.
- Tasks carry `listId` on the document (not the node) — subtasks are never in a
  different list from their parent.
- Deleting a list is a soft delete; tasks keep their `listId` and surface as
  ungrouped, so restoring the list restores their grouping.

---

## ADR-0005 — `Datum` is the date the task was raised

**Date:** 2026-08-11 · **Status:** accepted · **Source:** user answer to §17.6

**Decision.** `date` records when the task was raised. It defaults to today on
create and stays editable for corrections.

**Consequences.** No overdue highlighting, no deadline semantics, no sorting
affordance built around lateness. If a target date is wanted later it is a new
field via `custom` + `fieldRegistry`, not a reinterpretation of this one — which
would silently change the meaning of existing rows.

---

## ADR-0006 — Completion kind is policy keyed by depth, and `MAX_TASK_DEPTH` counts levels

**Date:** 2026-08-11 · **Status:** accepted · **Source:** spec §4

**Decision.** `completionPolicy: Record<number, CompletionKind>` maps depth to
completion shape — `{0: 'percent', 1: 'checkbox'}` — with a checkbox fallback
past the table. `changeCompletionKind` ships alongside it so flipping a depth is
one config line plus one migration call.

**Ambiguity resolved.** The spec's inline comment said children are empty at
`depth === MAX_TASK_DEPTH`, which contradicts "the cap is 2" combined with a
policy table keyed `{0, 1}`. We read `MAX_TASK_DEPTH` as a **count of levels**,
so valid depth indices are `0 .. MAX_TASK_DEPTH - 1` and the deepest node is at
depth 1. This is the reading consistent with the policy table.

**Consequences.** Nothing in `tree.ts` knows the words "main task" or "subtask".
Raising the cap to 3 is a constant change plus a policy entry.

---

## ADR-0007 — Maximum TypeScript strictness, including `noUncheckedIndexedAccess`

**Date:** 2026-08-11 · **Status:** accepted

**Decision.** `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, and unused
local/parameter checks.

**Consequences.**

- `array[i]` is `T | undefined`, so indexed access needs a guard. This is
  verbose and it is the point: the ordering and tree code indexes constantly.
- `exactOptionalPropertyTypes` is why persisted Zod schemas carry no
  `.default()` (see ADR-0013) and why optional fields are spread conditionally.
- Loosening any flag requires a new ADR, not a quiet edit.

---

## ADR-0008 — A new main task starts `derived`, not `manual`

**Date:** 2026-08-11 · **Status:** accepted · **Source:** user answer to §17.1

**Context.** The spec says two things that conflict at creation time: "adding a
subtask to a manual main task leaves it manual", and "zero children → derived is
meaningless, fall back to manual, default 0". Taken together at creation, a new
task would start manual and could never become derived, so the derived feature
the user chose would never engage.

**Decision.** Separate the two readings. Creation produces
`percentSource: 'derived'`, `percent: 0`. The "fall back to manual" rule applies
to the **transition** when the last child is removed, not to a task that never
had children.

**Consequences.**

- New task → add subtasks → the bar tracks them automatically. This is what the
  user asked for.
- Edit the percent by hand → manual, permanently, until "back to auto".
- Delete the last subtask from a derived parent → manual, keeping the last
  computed value rather than resetting to zero.
- A task with zero children that has never had any stays `derived` at 0%. The
  UI should not show the "auto" indicator when there are no children to derive
  from — a Phase 4 display concern, noted here so it is not forgotten.

---

## ADR-0009 — Tailwind v4, so `tokens.css` is the only token source

**Date:** 2026-08-11 · **Status:** accepted · **Deviates from spec §10**

**Context.** The spec asks for tokens in `/web/src/styles/tokens.css` _mirrored_
into `tailwind.config.ts`. Tailwind v4 (current) configures from CSS via
`@theme` and no longer uses a JS config file by default.

**Decision.** Use Tailwind v4. Tokens are defined once in `tokens.css`; the
`@theme inline` block in `index.css` exposes them as utilities.

**Consequences.** Strictly better for the spec's actual goal — there is now
exactly one place a token is defined, and no mirror to drift. `docs/TOKENS.md`
describes the swap procedure; its references to a `tailwind.config.ts` mirror
are superseded by this entry.

---

## ADR-0010 — Connection-string storage credentials, with the managed-identity path pre-built

**Date:** 2026-08-11 · **Status:** accepted · **Source:** `VERIFICATION.md` §3

**Context.** Verification confirmed SWA-managed Functions cannot use managed
identity to reach Blob Storage.

**Decision.** Authenticate with a connection string from SWA application
settings. `blobClient.ts` also implements `DefaultAzureCredential`, selected
when `AZURE_STORAGE_ACCOUNT_URL` is set, and prefers it when both are present.

**Consequences.** A long-lived shared secret exists in configuration and must be
rotated manually. Moving to a standalone Functions app later is an app-setting
change, not a code change. Full tradeoff in `VERIFICATION.md` §3.

---

## ADR-0011 — React 19, not React 18

**Date:** 2026-08-11 · **Status:** accepted · **Deviates from spec §10**

**Context.** The spec names React 18. React 19 is the current stable major.

**Decision.** React 19.

**Rationale.** This codebase is explicitly meant to live for years. Starting a
greenfield project on a superseded major means an upgrade is owed on day one.
Nothing in the spec's UI design depends on a React 18 behaviour.

**Consequences.** Flagged for the user rather than assumed silently — say so if
React 18 is required for an external reason, and the pin is a one-line change
while the UI is still a scaffold.

---

## ADR-0012 — TypeScript 5.9, not 7.x

**Date:** 2026-08-11 · **Status:** accepted

**Context.** TypeScript 7 (the native port) is the current `latest` tag, but
`typescript-eslint@8` declares a peer range of `>=4.8.4 <6.1.0`. Installing TS 7
breaks the lint step outright.

**Decision.** Pin TypeScript 5.9.3 — the mature end of the 5.x line and
unambiguously compatible with the rest of the toolchain.

**Consequences.** Revisit when `typescript-eslint` supports TS 7. The upgrade
should be mechanical; nothing in the codebase uses 5.x-specific behaviour.

---

## ADR-0013 — Zod 4 conventions: no `.default()` in persisted schemas, one hand-written recursive link

**Date:** 2026-08-11 · **Status:** accepted

**Decision.** Two conventions for the schema layer:

1. **No `.default()` inside persisted schemas.** A default makes a schema's
   input type diverge from its output type, which forces two-parameter generics
   everywhere and makes the recursive `TaskNode` annotation unworkable. Defaults
   live in the `create*` factories.
2. **The recursive link is the one hand-written type.** TypeScript cannot infer
   a self-referencing const, so `TaskNode` is declared as an interface extending
   `z.infer<typeof taskNodeBaseSchema>` and adding `children: TaskNode[]`. Every
   _field_ is still declared exactly once, in Zod.

**Consequences.** "Never define a type twice" holds for all fields. Adding a
field means editing `taskNodeBaseSchema` only. A test asserts the inferred type
is genuinely recursive and has not silently collapsed to `any`.

---

## ADR-0014 — Monotonic ULIDs

**Date:** 2026-08-11 · **Status:** accepted

**Context.** ULIDs were chosen because they sort lexicographically by creation
time, and the design leans on that: blob listing returns names in lexicographic
order, so tasks come back in creation order with no index and no sort key.

The plain `ulid()` export draws fresh randomness per call, so **two ids minted
in the same millisecond sort randomly relative to each other**. Caught by a test
asserting that 20 ids generated in a loop come back sorted — they did not.

**Decision.** Use `monotonicFactory()`, which increments the random component
within a millisecond, guaranteeing strictly increasing ids.

**Consequences.** The ordering guarantee holds under exactly the condition that
would otherwise break it — a burst of tasks created together, such as a bulk
import from the existing workbook.

---

## ADR-0015 — Blob metadata stores text as base64

**Date:** 2026-08-11 · **Status:** accepted

**Context.** Blob metadata values must be header-safe ASCII. Task titles are
Swedish: `Färdigställ växellådan` in a raw metadata header is a protocol
violation, not a display bug. Stripping or transliterating would corrupt the
titles the list view renders (ADR-0002).

**Decision.** Encode text metadata as base64 of UTF-8 (`titleb64`), using
`TextEncoder`/`btoa` so it works identically in the browser and in Node.

**Consequences.** Roughly 33% larger metadata, far inside the 8 KB limit.
Metadata is not human-readable in the portal — an acceptable cost, since it is a
cache and the document beside it is readable. Tests assert the round trip
survives Swedish characters and that all emitted metadata is pure ASCII.

---

## ADR-0016 — Attachment filenames are transliterated, not stripped

**Date:** 2026-08-11 · **Status:** accepted

**Decision.** `sanitizeFileName` maps `å/ä/ö/é/ü` to ASCII equivalents before
removing unsafe characters, so `Ritning-Färdig.pdf` becomes
`Ritning-Fardig.pdf` rather than `Ritning-F-rdig.pdf`.

**Consequences.** Blob paths stay legible in the portal and in
`Content-Disposition`. The original filename is preserved verbatim in the
document's `fileName` field, so the UI shows what the user uploaded — only the
storage path is transliterated.

---

## ADR-0017 — Free tier accepted; the allowlist replaces tenant restriction

**Date:** 2026-08-11 · **Status:** accepted · **Source:** user decision, `VERIFICATION.md` §1

**Context.** Verification found that the SWA Free plan cannot restrict the
built-in Entra ID provider to a single tenant — that requires a custom OIDC
provider, which is Standard-only at roughly $9/month. The user reviewed the
tradeoff and chose to stay on Free.

**Decision.** Authentication is open by platform constraint; **authorisation is
enforced in the application**. `withAuth` gates every route on an allowlist of
Entra object ids and email domains held in application settings.

**Consequences.**

- Any Microsoft account can reach the login page and complete it. Non-allowlisted
  principals get `403` from every route including `/api/me`, and the rejection is
  logged with the object id, because on this tier that log line is the signal
  that someone outside the organisation found the app.
- **The policy fails closed.** An unconfigured allowlist in a deployed
  environment denies everyone rather than admitting everyone. A misconfigured
  deploy should lock the owner out and be noticed, not silently publish the
  company's task list. Local development opts out explicitly via
  `AZURE_FUNCTIONS_ENVIRONMENT=Development`.
- Domain matching uses the part after the last `@`, so `modig.se@evil.com` does
  not match and `notmodig.se` does not match by suffix. Both are tested.
- Moving to Standard later removes the need for this but not the code: `can()`
  remains the place per-list and per-owner rules will grow.

---

## ADR-0018 — Request schemas are separate from document schemas

**Date:** 2026-08-11 · **Status:** accepted

**Context.** It is tempting to validate incoming payloads with the persisted
document schema, since it already exists.

**Decision.** `api/src/domain/requests.ts` defines narrower schemas for every
endpoint. A client may send `title`, `date`, `comments`; it may not send `id`,
`order`, `createdBy`, `updatedAt` or `completion`.

**Consequences.** A client cannot forge an audit trail or pick its own ids. The
cost is a second set of schemas to maintain, which is the correct trade at a
trust boundary — the alternative accepts every server-owned field by default and
fails silently when a new one is added.

---

## ADR-0019 — A conditional write against a missing blob surfaces as 409, not 404

**Date:** 2026-08-11 · **Status:** accepted · **Discovered by:** integration test

**Context.** Azure treats `If-Match` against a blob that does not exist as a
_precondition failure_ (412), not an absence (404) — an ETag cannot match
something that is not there. An integration test asserting 404 failed and
revealed the real semantics.

**Decision.** Let it surface as `concurrency_conflict` (409) rather than probing
for existence first.

**Consequences.** The client's existing conflict flow handles it correctly:
refetch, discover the 404, tell the user the task is gone. Probing before every
write would add a round trip to the common path to improve a rare one, and would
race anyway. Only reachable via an admin purge or the Phase-2 cleanup job, since
no v1 user action hard-deletes.
