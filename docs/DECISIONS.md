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

---

## ADR-0020 — Storage in Sweden Central, Static Web App in West Europe

**Date:** 2026-08-11 · **Status:** accepted · **Deviates from spec §1**

**Context.** The spec asks for Sweden Central with West Europe as a fallback.
Static Web Apps is a global service; the resource's region decides only where
the managed Functions execute, not where static assets are served from. Sources
disagreed on whether Sweden Central is a supported Static Web Apps region, and
it could not be confirmed given the documentation egress block.

**Decision.** Storage — all task documents and attachments — is in Sweden
Central. The Static Web App defaults to West Europe, the spec's own stated
fallback, and is a parameter.

**Consequences.**

- Data residency holds: both are EU regions, and the data itself never leaves
  Sweden Central.
- Requests hop Netherlands → Sweden for storage. At this volume the added
  latency is immaterial next to the round trip to the browser.
- Cheap to revisit: change `staticWebAppLocation` and redeploy. An unsupported
  region is rejected at deployment time before anything is created, so trying
  Sweden Central costs nothing but a minute.

---

## ADR-0021 — The Archive tier is disabled by default

**Date:** 2026-08-11 · **Status:** accepted · **Deviates from spec §13**

**Context.** The spec's lifecycle policy moves attachments to Cool after 60 days
and Archive after 365. But an archived blob cannot be served by a read SAS: the
request fails with `BlobArchived`, and rehydration takes hours. The attachment
pipeline (§11) reads exclusively through short-lived read SAS URLs.

**Decision.** Ship the Cool transition. Put the Archive transition behind
`enableArchiveTier`, defaulting to false.

**Consequences.**

- Attachments stay viewable at any age. Enabling archiving today would silently
  break viewing anything older than a year — and it would break it a year after
  deployment, long after anyone would connect the two.
- The saving forgone is a fraction of a euro per month at the projected volume,
  which is not worth a broken feature.
- To enable it later the UI needs an "archived — request restore" state and the
  API needs a rehydration endpoint. Recorded as an open item in
  `docs/VERIFICATION.md`.

---

## ADR-0022 — The deployment artefact is built in CI, not by the SWA build service

**Date:** 2026-08-11 · **Status:** accepted

**Context.** The API depends on `@taskhub/shared`, a workspace package that does
not exist on npm. The Static Web Apps build service (Oryx) would have to resolve
that itself, and its Node toolchain is not the one the tests ran under.

**Decision.** The workflow builds and tests everything, then `scripts/stageApi.mjs`
assembles a self-contained folder — compiled handlers, `host.json`, a
package.json with the workspace reference stripped, and `@taskhub/shared`
materialised into `node_modules` — and deploys with `skip_app_build` and
`skip_api_build`.

**Consequences.**

- What deploys is exactly what was built and tested, on one toolchain.
- The staging script is a moving part that must keep up with the workspace
  layout. It is smoke-tested by loading the staged entry point and confirming
  every handler registers, which fails loudly if a dependency stops resolving.
- `npm run verify` runs again inside the deploy workflow rather than trusting a
  CI run on a possibly older commit.

---

## ADR-0023 — Never set Tailwind's `--spacing` token

**Date:** 2026-08-11 · **Status:** accepted · **Found by:** screenshot review

**Context.** The spec asks for an 8px spacing grid. `tokens.css` set
`--spacing: 0.5rem` to express that. In Tailwind v4 `--spacing` is not a grid
step — it is the **base multiplier for every numeric size utility**. Setting it
to 0.5rem silently doubled the entire layout: `w-60` became 480px instead of
240px, `h-12` became 96px, and the task grid overflowed its container so the
right-hand columns were clipped and the header drew over the detail pane.

Nothing failed. It compiled, tested green, and rendered — just wrong. It was
found by taking a screenshot and measuring the sidebar.

**Decision.** Leave `--spacing` at Tailwind's default. The 8px grid comes from
using even-numbered utilities (`p-2` = 8px, `p-4` = 16px) on the 0.25rem base.
`tokens.css` carries a comment saying why the token is absent, so nobody
"fixes" it back.

**Consequences.** A reminder that a type-checked, fully-tested UI can still be
visually broken. Screenshots at each target width are part of verifying a UI
phase, not a nicety.

---

## ADR-0024 — Mobile rows are cards, not a narrowed grid

**Date:** 2026-08-11 · **Status:** accepted

**Context.** The spec requires the list to work at 360px. The desktop row is a
seven-column grid whose fixed columns alone exceed 360px before any content.

**Decision.** Below `md`, a row renders as a card: a 44px checkbox, the title,
and one meta line carrying date, percent, subtask progress and attachment
count. The column header is hidden, since it would label nothing.

**Consequences.** This is the same reasoning the spec applies to the layout as
a whole ("no three-column squeeze") pushed down to the row. Verified at 360px.

---

## ADR-0025 — Kommentarer is denormalised into blob metadata

**Date:** 2026-08-11 · **Status:** accepted

**Context.** §10 is emphatic that Kommentarer is a primary field and must be
visible in the list row. But the list view is built from a blob listing without
opening documents (ADR-0002), and the metadata projection carried no comments —
so the column rendered empty until a row was expanded.

**Decision.** Denormalise the first 200 characters into blob metadata as
`commentsb64`, and expose it on `TaskSummary` as `commentsPreview`.

**Consequences.**

- The list view still costs one request, and the column is populated.
- A test asserts that maximum-length title and comments together stay well
  inside the 8 KB metadata budget.
- The preview is truncated; the detail pane and the expanded row show the full
  text from the document.

---

## ADR-0026 — A local dev server, separate from the Functions host

**Date:** 2026-08-11 · **Status:** accepted

**Context.** Running the real API locally needs the Azure Functions Core Tools
and Azurite. That is right for API work but a heavy prerequisite for UI work,
and it makes verifying the frontend in a container awkward.

**Decision.** `scripts/devApi.mjs` serves the same `TaskService`, `ListService`
and `InMemoryTaskRepository` over plain `node:http`, plus the built bundle as
static files. `--seed` loads demo data exercising the awkward cases: a derived
50%, and a task completed at 40%.

**Consequences.**

- The UI can be run, screenshotted and verified with one command.
- It duplicates **routing only** — no business logic. The real handlers remain
  the deployed path and are covered by the Azurite integration tests.
- It has no authentication and is not for production; the file says so.

---

## ADR-0027 — Upload with XMLHttpRequest, not the storage SDK

**Date:** 2026-08-11 · **Status:** accepted · **Deviates from spec §11**

**Context.** The spec says to upload with the `@azure/storage-blob` browser SDK.

**Decision.** Use a plain `XMLHttpRequest` PUT to the SAS URL.

**Rationale.**

- The SDK exists to manage credentials, retries, chunking and a large surface of
  blob operations. We do one thing: PUT a single block blob to a URL that
  already carries its own authentication. Paying the SDK's bundle weight on
  every page load for that is a poor trade in an app whose entire design is
  shaped by cost.
- `XMLHttpRequest.upload.onprogress` is still the only way to observe upload
  progress in a browser — `fetch` has no equivalent — and progress with cancel
  is exactly what the spec asks for.

**Consequences.** Two headers must be right by hand: `x-ms-blob-type:
BlockBlob` (mandatory, and must appear in the storage CORS allowed-headers list
or the preflight fails) and `Content-Type`, which is bound into the SAS
signature. Both are covered by the integration tests, which upload the same way
the browser does — a raw PUT with no credential — so they prove the grant
itself, which a test using the SDK and the account key would not.

---

## ADR-0028 — SAS protocol is derived from the endpoint

**Date:** 2026-08-11 · **Status:** accepted · **Found by:** integration test

**Context.** A SAS is a bearer credential in a URL, so grants were pinned to
`SASProtocol.Https`. Every upload against the local emulator then failed with
`AuthorizationProtocolMismatch`, because Azurite serves plain HTTP.

**Decision.** Derive the protocol from the container URL: HTTPS-only when the
endpoint is `https:`, both otherwise.

**Consequences.** Deployed environments always get HTTPS-only grants, because a
real storage account is always `https:`. The constraint can only relax where the
endpoint is already insecure, so this cannot weaken production by accident.

---

## ADR-0029 — Attachment commits are serialised; uploads are not

**Date:** 2026-08-11 · **Status:** accepted · **Found by:** browser test

**Context.** Dropping two files at once uploaded both fine and then failed the
second commit with a 409: each commit is a conditional write against the task's
ETag, and both read the same version before either wrote.

**Decision.** Uploads stay fully parallel — that is where the time goes. The
commit step alone is serialised through a promise chain, so each commit reads
the ETag the previous one produced.

**Consequences.** Dropping a folder of photos works. The queue advances on
failure as well as success, so one rejected commit does not stall the rest. This
was invisible to every unit test and to a single-file upload; it took dropping
two files in a real browser to surface.

---

## ADR-0030 — Task blobs are matched as `{ULID}.json`, not `*.json`

**Date:** 2026-08-11 · **Status:** accepted · **Found by:** running the app

**Context.** The task listing matched any `*.json` blob in the container. The
container also holds `lists.json` (ADR-0004). The listing picked it up, found no
task metadata on it, fell back to opening it as a task document, and failed
validation — returning a 400 for the entire list view.

This would have happened the moment a user created their first list. Every unit
and integration test passed, because no test had both a list and a task listing
in the same container.

**Decision.** Match `^[0-9A-HJKMNP-TV-Z]{26}\.json$` — the ULID pattern —
rather than any JSON blob. A regression test now creates a list and asserts the
task listing still works.

**Consequences.** Non-task blobs can coexist in the container, which the
projection blob in the Phase-2 scale plan will need. A blob whose name is not a
ULID is not a task, which is a rule worth having explicitly.

---

## ADR-0031 — A separate token for interactive control boundaries

**Date:** 2026-08-11 · **Status:** accepted · **Found by:** measuring contrast

**Context.** The spec asks for subtle borders and 1px row separation, and
`--border-strong` was used for both row chrome and control outlines. Measured,
an unchecked checkbox's border was **1.48:1 on light and 1.72:1 on dark** — WCAG
1.4.11 requires 3:1 for the boundary of a user interface component. The checkbox
was present and effectively invisible, in the app's most-used control.

**Decision.** Introduce `--border-control` (neutral-500 in both themes, 4.76:1
light and 3.75:1 dark) for interactive boundaries, and leave `--border` subtle
for decorative separators, which carry no such requirement.

**Consequences.** Checkboxes and inputs read clearly; the dense list keeps its
quiet separators. `scripts/` holds no checker, but the token pairs and their
required ratios are listed in `docs/TOKENS.md` — re-measure after any palette
change, and especially after swapping in FinalInspection's real values.

**Also fixed by the same measurement:** `--danger-500` (#dc2626) measured
3.70:1 on the dark surface, below the 4.5:1 needed for text, so destructive
actions were the hardest thing on screen to read. Dark mode now uses #f87171
(6.45:1).

---

## ADR-0032 — SEO score is deliberately low

**Date:** 2026-08-11 · **Status:** accepted

**Context.** Phase 6 asks for Lighthouse ≥ 90 on mobile. Measured on a 360px
mobile emulation: **Performance 91, Accessibility 100, Best Practices 100, SEO 63.**

**Decision.** The SEO score stays low, on purpose.

**Rationale.** It is low because the app declares `noindex, nofollow` and a
`robots.txt` that disallows everything. That is correct: every route requires
authentication, so a crawler can never reach content, and an internal task
tracker for one company should not be in a search index. Lighthouse's SEO
category assumes you want to be found. Raising the score would mean removing the
directive that makes the app properly unlisted.

The score was _higher_ (82) before those directives existed, which is a good
illustration of why the number is the wrong target here.

**Consequences.** Judge this app on Performance, Accessibility and Best
Practices, all of which meet the bar. Note the measurement was taken against the
local dev server with gzip enabled to match what Static Web Apps serves; the
real CDN should do slightly better, not worse.

---

## ADR-0033 — Personal preferences live in localStorage, not on the task

**Date:** 2026-08-11 · **Status:** accepted

**Context.** People asked to choose where subtasks appear: expanded under their
parent in the list, as in the workbook, or only in the detail pane. Along with
row density and whether the Kommentarer column is shown, that is a set of
per-person view preferences the app now has to keep somewhere.

**Options.**

1. **On the task document.** Free — it rides along with data already being
   written. But it makes one person's viewing habit part of a shared record: two
   people opening the same task would fight over it, every preference change
   would be a blob write with an ETag and a possible 409, and the audit trail
   would fill with events that changed nothing about the work.
2. **A per-user blob** (`preferences/{userId}.json`). Shared across a user's
   devices, at the cost of one more blob per user, a read on every app start,
   and a new repository, service and endpoint.
3. **`localStorage`.** Instant, free, no request, no conflict. Does not follow
   the user to another device.

**Decision.** `localStorage`, keyed `taskhub.preferences`
(`web/src/lib/preferences.ts`).

**Rationale.** These are per-device settings as much as per-person ones: the
density that suits a workshop tablet is not the density that suits a 27-inch
desk monitor, so syncing them across devices is not obviously desirable. It also
keeps the storage account holding only work, which is the whole reason the
blob-only design stays inside the free grant. Column widths already work this
way (`columns.ts`), so this is the existing convention, not a new one.

**Consequences.** Preferences do not follow a user to a new browser or device;
they fall back to the defaults, which are chosen to match the workbook. Option 2
remains open if people ask for it — `readPreferences()`/`setPreferences()` are
the only call sites, so the change would be behind that pair. Reads merge field
by field against the defaults, so a preference added in a later release does not
arrive as `undefined` for everyone with a stored blob; a test covers that case.

**Not decided here.** Nothing about the preference is sent to the API, so no
schema, endpoint or migration changes.

---

## ADR-0034 — Main tasks are ordered by a value in their own blob

**Date:** 2026-08-11 · **Status:** accepted

**Context.** Drag-to-reorder. Subtasks were already solved: siblings live inside
one document under one ETag, so `reorderSiblings` rewrites one number and one
conditional write commits it atomically (§8, ADR-0001).

Main tasks are not siblings in anything. Each is its own blob, listed by name,
and the list view was ordered by ULID — creation order, with no way to express a
manual sequence. There is no parent document to hold the sequence and no single
ETag covering it.

**Options.**

1. **A sequence blob** (`order.json`, or a field on `lists.json`). One small
   write per reorder, atomic. But it becomes a second source of truth that every
   create and delete must maintain, and it is a lock: two people reordering
   anything contend on one ETag. It also has to answer for tasks it has never
   heard of.
2. **Order on the task**, mirrored into blob metadata. No new aggregate, no
   contention between people reordering different parts of the list, and the
   list view keeps reading a single listing. The cost is that a _renumber_ —
   when the float gap between two neighbours is exhausted — spans blobs and
   cannot be atomic.
3. **String fractional indexing** (keys like `a0`, `a0V`), which never needs
   renumbering. It would mean replacing the numeric ordering the domain already
   uses for subtasks and lists, tested and shipped, to avoid a case that needs
   ~20 consecutive drops into the same gap.

**Decision.** Option 2. `root.order` is the truth; `taskorder` in the blob
metadata is the cache the listing sorts by. `compareByOrderThenId` is the total
order, and the id tie-break means tasks written before this existed keep exactly
the order they had.

**Consequences, stated plainly.**

- **A normal move is one blob write.** The moved task gets a value between its
  new neighbours, guarded by the caller's `If-Match`. Nothing else is touched.
- **A renumber is not atomic.** When no float fits between the neighbours, every
  other task is renumbered to whole thousands, each read and conditionally
  written on its own ETag. A task that loses a race with a concurrent edit is
  skipped rather than clobbered, so the pass can be partial. That is the right
  trade: order values are self-healing — the next move renumbers again from
  whatever is there — and the alternative risks overwriting someone's words to
  tidy a sort key. The number of tasks rewritten comes back in the response as
  `X-TaskHub-Renumbered`, and in the `TasksReordered` event, so a partial pass is
  visible rather than silent.
- **Creating a task costs one extra listing.** `create` reads the existing
  summaries to compute `nextOrder`, so every task starts with a value of its own.
  Without it every task would share `ORDER_STEP`, no gap would exist anywhere,
  and the very first drag would renumber the entire list. A listing is the
  cheapest call in the API and a create is not a hot path; see `docs/COSTS.md`.
- **Two creates racing get the same order.** They tie, and the id tie-break puts
  the older one first. Not worth a lock.

**The API is anchored, not indexed.** `POST /api/tasks/reorder` takes
`{ movedId, afterId }`, where `afterId: null` means the head — deliberately
unlike `POST /api/tasks/{id}/reorder`, which takes a `toIndex` for children. A
client reordering children can see all of them, so its index and the server's
agree. A client reordering main tasks is nearly always looking at a filtered or
searched subset, where row 3 on screen is not task 3 in the true order. An
anchor id survives that; an index does not.

**Ordering is global, not per list.** A task keeps its place when it moves
between lists, and every view is a subsequence of one order. Per-list ordering
would need a position per list per task and an answer for "Alla uppgifter".

**The side panel needed none of this.** Reordering the user-defined lists uses
the same sparse floats and the same dnd-kit wiring, but every list lives in one
blob under one ETag (ADR-0004), so a move is a single conditional write that
lands whole or not at all — `POST /api/lists/reorder`, unchanged since Phase 4.
Two people reordering lists at the same time produce a 409, which is correct and
rare. The complexity above is the price of tasks being separate blobs, not of
drag-and-drop.

One thing worth writing down about the panel: reordering is off in the collapsed
icon rail. There is nowhere for a grip to live that is not the icon itself, and
nothing on screen to say what you picked up. The grip replaces the list icon on
hover when the panel is open — a 240px panel has no width for a column that is
empty most of the time — and stays visible on touch, where no hover is coming.

---

## ADR-0035 — Swipe to complete is one direction, and it toggles

**Date:** 2026-08-11 · **Status:** accepted

**Context.** §11 asks for swipe-to-complete on mobile. The card already carries
a checkbox, a tap that opens the task, a long-press grip that reorders it, and
sits in a list that scrolls — so the question was never how to detect a swipe,
it was what a swipe is allowed to take away from everything else a finger does.

**Decision.** One direction — right — and the same gesture toggles: swipe an
open task to tick it off, swipe a done task to reopen it. The band revealed
underneath says which, so the gesture never has to be remembered.

**Why not two directions.** Left would need a second meaning, and the only
candidate on this row is delete. That is exactly the action that should not be
one careless thumb away, particularly on a phone held in a workshop. A left
swipe therefore does nothing at all, and the row does not follow the finger that
way — a row that moved would promise an action that is not there.

**Why toggle rather than complete-only.** A one-way gesture leaves a completed
row with a dead swipe and no obvious way back, which teaches people the gesture
is unreliable. Toggling means the mistake and its fix are the same motion.

**How it shares the screen.** Three gestures start with a finger on the same
pixel, and each keeps its claim:

- **Scroll** wins ties. `touch-action: pan-y` gives vertical panning to the
  browser, and a gesture that starts more vertical than horizontal is dropped
  outright rather than tracked — so a later sideways wobble cannot resurrect it.
  Being wrong about a swipe costs a tap; being wrong about a scroll makes the
  whole list feel stuck.
- **Reorder** listens only on the grip and waits 220ms. A swipe moves
  immediately, so it fails that sensor's tolerance check before the delay
  elapses. The two cannot both fire.
- **Tap** is suppressed after a real swipe, or every completed task would also
  open its detail pane.

**Feedback.** The band is faint until the row has travelled far enough to act,
then goes solid. Without that there is no visible failure state, and a thumb
that stops short learns nothing.

**Accessibility.** The gesture adds nothing that is not already reachable: the
checkbox is unchanged and is what a screen reader announces, and the band is
`aria-hidden`. Mouse pointers are ignored outright — this is a touch affordance
on a layout that only exists on a phone.

**One bug worth recording.** The band was first drawn with `--success-500` and
`--warning-500` and white text: 3.30:1 and 3.19:1, both short of the 4.5:1 that
text needs. `docs/TOKENS.md` already warned that those steps fail as _text on
white_, and the same numbers apply to _white on them_ — contrast is symmetric,
which is the easy half of the rule to forget. The band now uses the 600 step
(5.02:1) and TOKENS.md says so in both directions.

---

## ADR-0036 — happy-dom, and `verify` refuses to run on the wrong Node

**Date:** 2026-08-12 · **Status:** accepted

**Context.** Two test files declare a DOM environment: `preferences.test.ts`
needs `localStorage`, and `useSwipeToComplete.test.ts` needs a renderer for
`renderHook`. Both were written as `// @vitest-environment jsdom`, and both
passed locally every time.

They had never passed in CI. The suite ran locally on Node 22; `.nvmrc` and the
workflows pin Node 20, because that is what the Static Web Apps managed
Functions run (`staticwebapp.config.json`: `apiRuntime: node:20`). Vitest 4
bundles jsdom 30, which loads undici 8, which calls
`webidl.util.markAsUncloneable` — a function Node 22 has and Node 20 does not.
On 20 both files fail to _load_: 335 tests ran instead of 354, the two missing
files reported as errors, and `npm run verify` exited non-zero.

CI had been red for four commits. It was found only when a merge to `main`
failed to deploy — which is to say, it was found by the deployment, not by the
tests, which is the wrong way round.

**Decision, part one.** Replace jsdom with **happy-dom** as the test DOM.

Downgrading jsdom cannot work: the version in play is vitest's own dependency,
not the workspace's, so pinning `jsdom` in `web/package.json` changes nothing.
Raising the project to Node 22 is worse — it would test the API on a runtime
the API does not run on.

Per §16, naming what a new dependency replaces and what it costs: happy-dom
replaces jsdom, is a devDependency, and is **never shipped, so the bundle cost
is zero**. `jsdom` is removed from `web/package.json`.

**Decision, part two.** `npm run verify` now reads `.nvmrc` and **refuses to run
on a different Node major**, with `TASKHUB_ALLOW_NODE_MISMATCH=true` as the
explicit override.

This is the more important half. The jsdom incompatibility was a day's-worth
annoyance; the process failure behind it is that `verify` — the one command the
whole project treats as proof — was quietly proving something about a runtime
nobody deploys. A gate that can be green while CI is red is not a gate. It is
now impossible to get that reassurance by accident.

**Consequences.** Anyone on a different Node sees an actionable message instead
of a false pass. The override exists so the failure is a decision rather than a
wall, and it says in the message what the result is worth.

**What this does not fix.** `verify` still cannot catch a difference between the
CI runner and a developer machine that is not the Node major — a different
package-lock resolution, a platform-specific path. Those are still found by CI,
which is why CI runs even when verify is green. The lesson is narrower than "add
a check": **look at CI after pushing.** Four commits went by without anyone
doing so, this session included.

---

## ADR-0037 — The staged API must prove it stands alone

**Date:** 2026-08-12 · **Status:** accepted

**Context.** The first real deployment served **404 on every API route**. The
build was green, the deployment reported `Ready`, the bundle rendered, Entra
sign-in worked — and Azure had registered zero functions.

Two defects in `scripts/stageApi.mjs`, both of which are invisible on a
developer machine and fatal on the target:

1. **Order.** The script materialised `@taskhub/shared` into the staged
   `node_modules` and _then_ ran `npm install`. npm prunes anything not in the
   dependency tree, and `@taskhub/shared` is deliberately not in it — because it
   does not exist on the registry. So npm deleted it again. The deployment log
   said `added 61 packages, and removed 1 package`, and that removed package was
   the entire domain layer.
2. **Transitive dependencies.** `@taskhub/shared` needs `ulid` and `zod`. A
   hand-copied package's `dependencies` are metadata, not instructions, so
   nothing installed them.

Both survived every check because of Node's module resolution: an import that
fails inside `api-deploy/node_modules` keeps walking up, reaches the workspace
root, and finds the hoisted copy. Every local test passed — including one this
session that loaded the staged entry point and reported success. It was a false
positive produced by the very directory the deployment does not have.

The failure mode is the worst kind. An entry module that throws leaves the
Functions host with nothing registered, and a host with no functions returns 404
rather than 500 — indistinguishable from a routing mistake. With Application
Insights deliberately unprovisioned (ADR: it is the classic surprise line item),
there was no log anywhere saying so. Hours went into platform theories — the
Node v4 programming model, ESM versus CommonJS, the storage SDK's `engines`
field — for a bug that was in our own build script and named in our own logs.

**Decision.**

1. Install first, materialise second.
2. Merge `@taskhub/shared`'s runtime dependencies into the staged
   `package.json`, so npm installs them.
3. **Copy the staged folder to a temp directory outside the workspace and import
   its entry point there.** Staging fails if it does not load.

**Why the third one is the point.** The first two are the bugs; the third is why
they will not recur in a new form. A presence check over declared dependencies
would have caught defect 1 and missed defect 2. `require.resolve` would have
missed both, because it walks up. Only loading the folder somewhere with no
workspace above it asks the question the deployment asks: _does this work on its
own?_ It costs a directory copy and about a second, against an API that deploys
clean and answers 404.

This is the same lesson as ADR-0036 one day earlier: a check that runs in a more
forgiving environment than production is not a check. There it was the Node
version; here it is the directory tree. Both were caught by the deployment
rather than by the tests, which is the wrong way round twice.

**Consequences.** `npm run deploy`-time staging is a few seconds slower. A
broken artefact can no longer reach Azure: the Deploy workflow runs this script,
so the job fails before the upload step. If `@taskhub/shared` ever grows a
dependency, the staged folder picks it up automatically rather than silently
relying on hoisting.

---

## ADR-0038 — Editing Kommentarer from the row fetches the task first

**Date:** 2026-08-12 · **Status:** accepted

**Context.** Kommentarer was read-only in the list until a row was expanded or
selected, which read as a bug: the cell looks like every other editable cell and
refuses to take a click.

It was not arbitrary. A collapsed row has never opened its blob — that is the
point of the metadata projection (ADR-0002) — so the text it shows is
`summary.commentsPreview`, cut at `COMMENTS_PREVIEW_LENGTH` (200). Making the
cell editable as it stood would mean a user clicking a long comment, seeing 200
characters, pressing Enter, and silently destroying the rest. Data loss with no
error and no undo.

**Options.**

1. **Edit the preview, accept the truncation.** No.
2. **Allow editing only when the preview is provably complete** — when it is
   shorter than the cut. Free, but the behaviour becomes "sometimes editable",
   which is harder to explain than "never editable" and still surprises whoever
   hits the long one.
3. **Put the full comment in blob metadata.** Metadata is capped at 8 KB per
   blob across all values; comments are `COMMENTS_MAX_LENGTH` and would blow the
   budget for every task in the list.
4. **Fetch the document when the user asks to edit.**

**Decision.** Option 4. Clicking the cell requests the aggregate, shows the
preview meanwhile with a quiet pulse, and mounts the real editor — already
focused, carrying the full text — the moment it lands. `InlineText` grew an
`autoEdit` prop for that hand-off; it is read on mount, so swapping the
placeholder for the editor is what triggers it.

**Consequences.** One extra GET the first time a row's comment is edited, and
none after — the container keeps the aggregate once loaded. There is no way to
truncate a comment by typing in a cell. The row still renders from the listing
alone until someone actually wants to edit, so the list view is still one
request.

**Not changed.** The mobile card shows the preview as text and does not offer
inline editing; the detail pane is where a comment gets written on a phone.

---

## ADR-0039 — One drag context for the whole shell

**Date:** 2026-08-12 · **Status:** accepted

**Context.** Dragging a task row onto a list in the side panel should move the
task into that list. The API already did it — `PATCH /api/tasks/{id}` with
`listId`, which is exactly why `listId` lives on the document rather than the
node (ADR-0004). The obstacle was entirely on the client.

Drag-and-drop had grown up in two places: `TaskListView` owned a `DndContext`
for tasks and subtasks, `LeftPanel` owned another for lists. Each was correct in
isolation, and dnd-kit cannot drag between two contexts at all. A drop that
crosses regions has no home in that arrangement.

**Decision.** One `DndContext` above the whole shell, in `DragSurface`, which
owns what a drop _means_:

| picked up | dropped on | result                               |
| --------- | ---------- | ------------------------------------ |
| task      | task       | reorder the main list                |
| task      | list       | move the task into that list         |
| child     | child      | reorder subtasks within their parent |
| list      | list       | reorder the side panel               |

Anything else is refused. The regions below keep their own `SortableContext` and
their own rendering; only the arbitration moved.

**Two things this forced, both load-bearing.**

_Collision detection is pointer-first._ `closestCenter` compares the dragged
row's centre against every droppable, and a task row dragged onto the panel is
still closest, by centre, to the row it came from — the panel can never win and
the drop is impossible. `pointerWithin` asks what the user is actually
answering: what is under my cursor. It returns nothing for a keyboard drag,
which is what the `closestCenter` fallback is for.

_The vertical-axis modifier had to become conditional._ A task has to travel
sideways to reach the panel; pinning it to the vertical axis makes the feature
unreachable. Subtasks and lists still only reorder within a column, and keeping
them pinned is what stops a near-miss reading as a failed drag. So the modifier
is applied by what is being dragged, not globally.

**Consequences.** `DragSurface` reads `useTasks(filter)` and `useLists()`, which
costs no request — TanStack Query hands back the arrays the panel and list are
already rendering. Drop targets are desktop-only in practice: on a phone the
panel is a drawer that is closed while you are looking at the list, so there is
nothing to drop onto. Dropping on "Ogrupperade" removes a task from every list,
which is otherwise a gesture the app does not have.

**Rejected:** keeping the two contexts and hand-rolling a hit test against the
panel during a task drag. It works until it does not — no keyboard equivalent,
no announcements, and a second drag system to maintain beside the first.

---

## ADR-0040 — Photographs are shrunk in the browser before upload

**Status:** accepted · **Date:** 2026-08-12

**Context.** A phone photograph is 3–5 MB and around 4000px on its longest edge.
Nothing in the app displays one at more than a fraction of that: the grid shows
a 400px thumbnail and opening one fills a laptop screen. Those pixels are paid
for three times — upload time on workshop wifi, storage at rest every month
(the largest single line in `docs/COSTS.md`), and egress on every view.

The upload pipeline shipped in Phase 5 uploaded the file untouched and generated
a thumbnail beside it, so both the 5 MB original and a 30 kB preview were stored.

**Decision.** Re-encode images on a canvas in the browser before the SAS is
requested: longest edge to 2560px, JPEG at quality 0.82. The user can turn this
off (`imageQuality: 'original'` in preferences) for the case where the
resolution itself is the record.

**Where in the pipeline, and why it cannot move.** Compression runs _first_,
before local validation and before the grant. The SAS is signed for one blob
path derived from the filename, and `commit` compares the real uploaded size
against the declared one — so a file that changes name or size after the grant
is issued fails at the last step. Everything downstream has to see the file that
will actually be uploaded.

**2560px and 0.82 are not round numbers.** 2560 is above a 1440p screen, so a
photo still fills any monitor in the building at full quality while a 12MP
camera photo loses about two thirds of its pixels. Above quality ~0.85 JPEG
files grow quickly for differences nobody sees.

**What is deliberately not compressed.**

| Type            | Why                                                         |
| --------------- | ----------------------------------------------------------- |
| GIF             | a canvas keeps the first frame; re-encoding kills animation |
| WebP            | already efficient, and it may be animated                   |
| < 256 kB        | nothing worth taking, and re-encoding only loses quality    |
| everything else | a PDF drawing has to arrive byte for byte                   |

PNG stays PNG rather than becoming JPEG: screenshots of drawings and error
dialogues are mostly text, and JPEG makes text edges mushy. Resizing alone is
the win there.

**Three guards, each for a failure that actually happens.**

_The candidate must be at least 10% smaller._ Re-encoding an already-optimised
JPEG can produce a _larger_ file. Without the check, "compression" would
sometimes cost bytes — worse than doing nothing and much harder to notice.

_The output blob's own type names the file, not the type we asked for._
`canvas.toBlob` falls back to PNG when it cannot encode the requested format.
Naming a PNG `.jpg` is a lie the extension allowlist accepts and no viewer
forgives, so a type with no known extension keeps the original file instead.

_Every failure path returns the original._ `compressImage` returns null rather
than throwing: a HEIC on a browser with no HEIC decoder, a canvas that will not
allocate, a file whose extension lies. A missed saving, never a failed upload.

**Two things that fall out of this, both worth having.**

HEIC becomes JPEG where the browser can decode it (Safari can, Chrome cannot).
An iPhone HEIC does not open on a Windows desktop without a codec pack, so the
phone-to-desk handoff quietly fails today; transcoding fixes it, and where the
decoder is missing the original is uploaded exactly as before.

Re-encoding drops the EXIF block, GPS coordinates included. A photo taken on
someone's personal phone stops carrying the location of the person who took it.

**`imageOrientation: 'from-image'` is now stated explicitly**, here and in
`generateThumbnail`. A portrait phone photo is landscape pixels plus a rotation
flag, browsers have disagreed about whether that flag applies by default, and
the difference is a sideways photograph. Re-encoding then bakes the rotation
into the pixels so every later viewer agrees which way is up.

**Compression is serialised across concurrent uploads**, like commits but for a
different reason: decoding a 12MP photo costs roughly 48 MB of bitmap, and
dropping eight at once would decode them in parallel and take most of a phone's
memory. The tab dies rather than the upload failing politely. Uploads themselves
stay parallel.

**Consequences.** Measured end to end against Azurite through the real SAS path:
a 4000×3000 photograph of random noise — the worst case for JPEG, since a real
photograph has structure to exploit — went from 9.8 MB to 2.3 MB, a 77%
reduction. Real photographs do better. The upload row shows both numbers, struck
through, so the app says out loud that it rewrote someone's file.

**Rejected:** compressing server-side. It means Function execution time and an
image library on a footprint budgeted below €2/month, for something the browser
already does. Also rejected: converting PNG to JPEG for the extra saving, which
trades legible screenshots for bytes.

---

## ADR-0041 — Deleting an attachment is confirmed, and reachable with a thumb

**Status:** accepted · **Date:** 2026-08-12

**Context.** Delete was wired up in Phase 5 and looked finished: the grid
rendered a trash `IconButton` and `AttachmentsSection` called
`api.deleteAttachment`. It was gated on `opacity-0 group-hover:opacity-100`, so
on a phone — no hover — the button was invisible and untappable. This is the
third instance of the same bug in this codebase, after the drag grips in
`LeftPanel` and `TaskRow`.

**Decision.** The button stays visible on touch layouts with a 44px hit area,
and deletion is confirmed inline on the tile rather than with a modal or a
second tap on the same control.

**The confirmation names the file.** Tiles are small and sit two or three to a
row; "which one did I just tap" is a fair question, and the answer costs one
line of text.

**Three details that were wrong in the first version and are worth recording,
because none of them are visible in the source.**

_The overlay is opaque._ At `bg-surface/95` the filename and the trash icon
underneath still showed through as ghosted text, which reads as a rendering
fault rather than a deliberate overlay.

_The trash button is unmounted while its own tile is confirming._ Left in place
it stayed clickable and in the tab order _underneath_ the overlay — two controls
named "Ta bort" on one tile.

_The buttons are stacked at every width._ Side by side they wrapped their labels
to "Ta / bort" in both the two-column phone grid and the three-column desktop
one.

**Focus lands on Cancel.** The control that opened the overlay has just been
unmounted, so focus has to be placed somewhere or it falls to the body — and
when the other option is destructive, the safe one is where it goes.

**The confirming button's border is an inline style, not a class.** The `danger`
variant sets `border-transparent`, and between two utilities of equal
specificity the winner is whichever Tailwind emits later, not whichever is
written last in the attribute. Verified in the browser: with a class the
computed `borderColor` stayed `rgba(0, 0, 0, 0)`.

**Consequences.** Nothing is destroyed. The API removes the attachment from the
document and leaves the blob in place (§5), so a deletion is recoverable from
storage — there is simply no button that puts it back. A failed delete now
surfaces its message and refetches the task, because the usual cause is a stale
ETag and the previous code discarded the rejection silently, which is
indistinguishable from a tap that never registered.

---

## ADR-0042 — Moving a subtask between main tasks writes the destination first

**Status:** accepted · **Date:** 2026-08-13

**Context.** A subtask can now be dragged onto a different main task's row. Every
other drag in the app rewrites one blob. This one rewrites two — the subtask
leaves one aggregate and joins another — and there is no transaction across two
blobs in Blob Storage.

**Decision.** Graft into the destination first, then remove from the source.

The order is chosen entirely by what a half-finished move leaves behind:

| Order              | If the second write fails        |
| ------------------ | -------------------------------- |
| graft, then remove | the subtask is in **both** tasks |
| remove, then graft | the subtask is in **neither**    |

A visible duplicate someone can delete beats a subtask that has quietly stopped
existing. So the graft goes first, and if the removal then fails the graft is
undone; only if that compensation _also_ fails does the caller get an error, and
that error names both tasks and says the subtask is duplicated rather than
offering a generic failure.

**Both writes are conditional.** The caller's `If-Match` guards the source — it
is the version the user was looking at. The destination is guarded by the ETag
read moments earlier in the same call, which is what stops the move landing on
top of somebody else's concurrent edit. A test proves the stale-ETag case ends
with the subtask in exactly one place.

**`graftNode` is not `addChild`.** `addChild` builds a new node from a title;
`graftNode` adopts an existing one whole — id, percent, tick, attachments and
its own children all travel with it. A move that produced a new subtask with the
same title would lose the photographs attached to it, which in this app is the
evidence.

Two guards that `addChild` does not need:

- **The whole subtree is measured against the depth cap**, not just its top
  node. `addChild` only ever adds a leaf and can compare one depth; a graft can
  carry children.
- **Completion shape is checked against the arriving depth.** Completion is
  chosen by depth, so a node landing at a different depth than it left would
  carry the wrong kind — a derived percent where a manual one belongs. Today
  every subtask moves from depth 1 to depth 1 and this never fires; it exists so
  that raising `MAX_TASK_DEPTH` fails loudly instead of corrupting a document.

**The client mutation is deliberately not optimistic**, unlike every other drag
here. The others rewrite one cached document and can put it back on failure.
This one changes two, and the destination may not even be in the cache — a
collapsed row has never been opened. Predicting a two-step server write that can
legitimately end in either place would mean showing a result the server has not
agreed to yet.

**Consequences.** The subtask lands last among its new siblings; there is no
position to specify in the request, so placing it is a second drag. Both tasks'
derived percent recompute — the source loses a child, the destination gains one.
`SubtaskMoved` is the only event that names two aggregates.

**Rejected:** making the move a delete plus a create. It is simpler to write and
loses the subtask's identity, its history and its attachments.

---

## ADR-0043 — The files view is built on the blob listing, and deleting means deleting

**Status:** accepted · **Date:** 2026-08-13

**Context.** Attachments could only be seen from inside the task they belonged
to. Nothing in the app could answer "what is stored", which is the question
behind both "clear out the photos I no longer need" and "why is storage the
largest line in `docs/COSTS.md`".

**Decision, part one: storage is the index.** `GET /api/files` is one blob
listing joined against one task listing. The blob path convention from §5 —
`{taskId}/{attachmentId}/{fileName}` — already carries which task and which
attachment the bytes belong to, so `parseAttachmentPath` recovers the join key
without opening a single task document.

The alternative was to assemble the list from the task documents, which are the
authority on attachments. At 500 tasks that is 500 blob reads to answer one
question, against one paged listing. `ListBlobs` is billed at the write rate
(~€0.05/10,000) and is still far cheaper than the reads it replaces.

What this buys beyond cost: **size, type and date come from the blob itself**,
not from a record that could disagree with it, and **files whose task is gone
still appear**. A storage view that hid unreachable files would hide exactly the
ones most worth deleting.

Thumbnails are filtered out of the listing but counted in what storage holds.
They are a cost, not a file anyone uploaded.

**Decision, part two: delete removes the bytes.** This reverses the §5 stance
that nothing a user does in v1 destroys bytes, and it does so on purpose. The
view exists so someone can reclaim storage; an unlink that leaves the blob
behind reclaims nothing while looking like it did. The old behaviour would have
meant a growing pile of unreachable blobs that no user action could ever remove.

Deletion is confirmed in the UI before it is called, and it is genuinely
irreversible — there is no undo and no recovery path short of the storage
account's own retention settings.

The document is written first, then the bytes. If the blob delete fails the file
is unreferenced but still stored, which shows up in this view as an orphan and
can be deleted again. The other order would leave a document pointing at bytes
that were already gone.

**Two delete paths, one button.** A file a task still references goes through
`DELETE /api/tasks/{id}/attachments/{attachmentId}`, which writes the document
under an `If-Match` first. A file nothing references has no document and no
ETag, so it goes through `DELETE /api/files/{taskId}/{attachmentId}`, which
touches only bytes — and which refuses if a task does still claim the file, so
it cannot be used to skip the conditional write. The client picks the path; the
user sees one action.

**Download is a SAS field, not a proxy.** `contentDisposition` on the grant
comes back as a response header, so the browser saves the file under its own
name instead of rendering a JPEG in a tab. A 20 MB download therefore never
passes through a Function, which on the Free tier is the difference between free
and metered.

**Consequences.** The view is deliberately not filtered by the selected list: it
is a storage view, not a task view, so it sits with "Alla uppgifter" and
"Ogrupperade" rather than among the lists. It is never a drop target. Search
covers filename and task title, because those are the two things people
remember.

**Rejected:** a separate index blob listing every attachment, in the style of
`lists.json`. It duplicates what storage already knows, adds a second thing to
keep in sync, and introduces a write-contention point on every upload.

---

## ADR-0044 — Photographs are decoded at target size, never at full size

**Status:** accepted · **Date:** 2026-08-13

**Context.** ADR-0040 added client-side compression and it worked on every
machine it was tested on. Then it failed on a phone: uploading a photo produced
Brave's own "För lite minne" toast and no upload, with nothing reaching the
app's error handling at all.

The arithmetic explains it. A decoded bitmap costs four bytes per pixel no
matter what the file weighed:

| Camera              | Pixels | Decoded bitmap |
| ------------------- | ------ | -------------- |
| 12MP (4000×3000)    | 12M    | **46 MB**      |
| 50MP (8160×6120)    | 50M    | **191 MB**     |
| 200MP (16320×12240) | 200M   | **762 MB**     |

The first implementation decoded at full size and _then_ scaled to 2560px on a
canvas. Allocating 191 MB on a phone with other tabs open does not throw
something a `try`/`catch` can see — the browser aborts the action and reports it
itself, which is why the failure was invisible to the app.

**Decision.** Ask the decoder for the size we want. `createImageBitmap` takes
`resizeWidth`/`resizeHeight`, and a JPEG's DCT layout lets a decoder downsample
by halves almost for free, so the full bitmap is never materialised. Measured in
Chromium on a 50MP source: **191 MB → 19 MB**, and the result is the same
2560px image either way.

**Dimensions come from an `<img>`, not from a decode.** The target size cannot
be computed without knowing the source size, and asking `createImageBitmap` for
it defeats the purpose. An `<img>` that is never inserted into the document
parses the header for `naturalWidth`/`naturalHeight` and defers the pixel
decode, so it costs about the file size rather than the bitmap size. It has a
second advantage: those values already account for EXIF orientation, which keeps
them consistent with the `imageOrientation: 'from-image'` decode.

**Never enlarging is a memory rule here, not only a quality one.** Requesting
2560px for a 1200px photo would allocate _more_ than decoding it untouched, on
the device least able to spare it.

**Both decode paths were affected**, and fixing only the obvious one would have
left the crash in place. `generateThumbnail` also decoded at full size, and it
matters most exactly when compression was skipped — a HEIC the browser cannot
re-encode, or someone who chose "keep original" — because then the file reaching
it is the untouched 50MP photo.

**Consequences.** A browser that accepts `createImageBitmap` but not every
option in the dictionary (older Safari) falls back to a plain decode: the old
memory cost, which is what those browsers were living with anyway, rather than a
failed upload. Where the header cannot be read, the fallback is the same — such
files are small or exotic, not 50MP cameras.

**What this says about the earlier verification.** Serialising compression
(ADR-0040) bounded how many photos decode _at once_ and did nothing about how
large a single one is, which is the case that actually broke. Every mobile check
until now had been an emulated viewport on a desktop with gigabytes free; the
bug needed a real phone with 45 tabs open to appear. The emulator was never
going to find it.

---

## ADR-0045 — Photographs are taken inside the page, not by the camera app

**Status:** accepted · **Date:** 2026-08-13

**Context.** Taking a photograph from the attachments panel never worked on a
real phone, from the day it was built. Three fixes to what happens _after_ the
file arrives changed nothing:

1. compression decoded at full size — fixed, no change
2. `capture="environment"` was removed, and empty selections were reported —
   no change
3. the last full-resolution decode (an `<img>` load to read dimensions) was
   replaced with a header parser — no change

Three misses in the same place is information. What they have in common is that
all three assume the file reaches JavaScript. The user's own account is that the
photograph is taken successfully and the failure happens _on the way back_, with
the phone reporting too little memory and the camera app working perfectly on
its own.

**Decision.** Stop asking the operating system for a photograph. `getUserMedia`
puts a live camera preview inside the page, and the shutter draws the current
frame to a canvas.

There is no handoff, so there is nothing to fail: no second application starts,
the page never leaves the foreground, and nothing has to survive being suspended
while a camera app allocates hundreds of megabytes. The photograph is produced
inside the page that wants it.

**The resolution trade costs nothing here.** A frame from the video stream is
smaller than what the camera app would save — but every photograph is scaled to
2560px on upload anyway (ADR-0040), so the stream is asked for roughly that. The
result is the same picture that would have survived compression, without ever
building the enormous one that could not survive the journey.

**The camera is released explicitly.** A track left running keeps the phone's
camera indicator lit and the sensor powered long after the user has moved on,
which looks like the app watching them. `stop()` runs on capture, on close and
on unmount.

**Permission refusal and a missing camera are told apart** by the error name and
given different advice, and both offer the file picker rather than an apology —
that path is known to work on the affected phone.

**Consequences.** The site must be HTTPS, which it is, and
`Permissions-Policy: camera=(self)` must allow it, which it already did. Desktop
gets the same in-page camera, which is a small bonus on a laptop with a webcam
and never worse than the file picker beside it.

**What is not claimed.** The original failure is still not _explained_ — only
avoided. Something in the OS round trip cannot complete on that phone, and this
app is no longer part of that conversation. If the file picker ever fails the
same way, the cause is elsewhere entirely.

**Rejected:** more repairs to the file-input path. Three attempts produced three
regressions in behaviour nobody could observe from here; a fourth would have
been the same bet again.
