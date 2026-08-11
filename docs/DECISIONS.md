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

**Not decided here.** Reordering the user-defined lists in the side panel. The
API for it has existed since Phase 4 (`POST /api/lists/reorder`) and is
unconnected to any UI.
