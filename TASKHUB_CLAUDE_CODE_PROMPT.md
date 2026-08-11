# TaskHub — Claude Code Kickoff Prompt

> Paste this whole file into Claude Code as the opening prompt (or save it as `PROJECT_SPEC.md` in an empty repo and open with `claude`, then say "read PROJECT_SPEC.md and start Phase 0").
>
> Working name `TaskHub` — rename globally before Phase 1 if you have a better one.

---

## 0. Mission

Build a modular, multi-user task management web app for Modig Machine Tool.

Core loop: a user creates a **main task**, adds **subtasks** under it, marks items complete, and attaches **files (images, PDFs, documents)** to either the main task or any subtask. Modern SaaS UI. Equally usable on a desktop browser and a phone.

It runs on the cheapest viable Azure footprint: **Azure Static Web Apps (Free) + Azure Blob Storage**. **No database in v1.** The app must be architected so a real database can be introduced later without rewriting the domain or UI layers.

This codebase will be extended for years. Treat every design decision as "will this still be sane after five more features?" Prefer boring, explicit, well-seamed code over clever code.

---

## 1. Hard constraints

| Constraint | Detail |
|---|---|
| Hosting | Azure Static Web Apps, **Free tier**, with SWA-managed Azure Functions for the API |
| Persistence | Azure Blob Storage only (StorageV2, LRS, Hot). No SQL, no Cosmos, no Table Storage in v1 |
| Region | Sweden Central (fallback West Europe). All data stays in the EU |
| Cost | Target < €2/month at 5 users and ~2 GB of attachments. No standing charges beyond storage |
| Auth | Entra ID via SWA built-in authentication |
| Runtime | Node 20 + TypeScript everywhere (frontend and Functions) |
| OS | Developed on Windows natively — no WSL-only tooling, no bash-only scripts. All npm scripts must run in PowerShell |
| Repo | Must not live inside a OneDrive-synced folder. Confirm the path before `git init` |

### Explicitly out of scope for v1
Real-time collaboration, notifications/email, Gantt/calendar views, time tracking, comments/mentions, recurring tasks, Monitor G5 integration, full-text search across attachment contents. **Design the seams for these, build none of them.**

---

## 2. Verify before you build

Do not trust training data on Azure specifics. Before Phase 1, check current Microsoft docs and report findings to the user:

1. **SWA Free tier + Entra ID auth** — confirm whether the built-in provider is available on Free, or whether a custom OIDC provider (Standard tier) is required. This is a cost-decision blocker; surface it immediately if Standard is needed.
2. **SWA-managed Functions on Free** — supported runtimes, request body size limit, execution timeout.
3. **Managed identity from SWA-managed Functions to Blob Storage** — if unsupported, fall back to a connection string in SWA application settings and document the tradeoff.
4. **Blob index tags** — availability on StorageV2 LRS and the per-blob tag limit.

Report each as *confirmed / changed / blocked* before writing code that depends on it.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Azure Static Web Apps (Free)                        │
│                                                      │
│  /web    React 18 + TS + Vite + Tailwind (static)    │
│  /api    SWA-managed Azure Functions v4 (Node 20)    │
│  /shared Zod schemas + domain types (imported by both)│
└───────────────────────┬──────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │ JSON aggregates + SAS grants  │
        ▼                               ▼
┌────────────────────┐        ┌──────────────────────┐
│ Blob: tasks        │        │ Blob: attachments    │
│ one blob per main  │        │ browser uploads      │
│ task (w/ subtasks) │        │ direct via SAS       │
└────────────────────┘        └──────────────────────┘
```

### The three decisions that matter

**1. One blob per main task, containing its subtasks.**
The main task and its subtasks are a single *aggregate*. They are written together, read together, and versioned together with one ETag. This gives atomic subtask edits with zero transaction machinery. Subtasks are never separate blobs.

**2. No index blob. The list view is built from blob listing + metadata.**
Writing a shared index blob on every save creates a write hotspot and a second thing to keep consistent. Instead, denormalise the fields the list view needs (title, status, counts, due date, priority) into **blob metadata**, which Azure returns inline on a list call. One request populates the whole left panel.

Document this limit in the code: this approach is fine to roughly 1,000 tasks. Past that, add a projection blob rebuilt by a queue-triggered function. Leave a `// SCALE:` comment at the listing call marking the swap point.

**3. Everything goes through a repository interface.**
The API layer never touches `@azure/storage-blob` directly. It calls `ITaskRepository`. When a database arrives, you write `SqlTaskRepository` and change one line of DI wiring. This is the single most important rule in the codebase — enforce it in review.

### Rejected alternatives (do not revisit without asking)
- *Table Storage* — cheap and would give real queries, but the user wants blob-only for v1. Keep it as the documented Phase-2 upgrade path.
- *Separate blob per subtask* — needs cross-blob transactions to keep parent counts correct. No.
- *Everything in one giant `tasks.json`* — every write collides. No.

---

## 4. Domain model

Define in `/shared/src/domain/`. Zod schemas are the single source of truth; TypeScript types are inferred from them (`z.infer`). The same schemas validate on the client (form feedback) and in the Function (trust boundary). Never define a type twice.

### Source of truth: the existing spreadsheet

The app replaces a Modig Excel workbook. Its columns define the **first-class fields** — do not invent extras and do not drop any:

| Excel column | Domain field | Notes |
|---|---|---|
| `Toggle` (↓) | — | Pure UI. Expand/collapse of subtasks. Not persisted data |
| `Datum` | `date` | ISO date, no time. Defaults to today on create. Editable |
| `Uppgift` | `title` | Main task renders bold; subtask renders indented under it |
| `Kommentarer` | `comments` | Free text, multi-line. **Visible in the list row**, not hidden in a detail pane |
| `Status` | `completion` | Depth-dependent: checkbox on subtasks, percent + override checkbox on main tasks. See below |
| `Färdig datum` | `completedDate` | Auto-stamped when status flips to done; remains manually editable |

Everything beyond this table (priority, assignee, labels) is **not** in v1. Those go through `custom` + `fieldRegistry` (§9) if requested later, so the default UI stays as clean as the sheet.

```ts
// Recursive by design, but capped. Today the cap is 2 (task → subtask).
// Raising it to 3 must be a config change, not a refactor.
export const MAX_TASK_DEPTH = 2;

TaskNode {
  id: string                     // ULID — sortable by creation time
  title: string                  // Uppgift, 1..200
  date: string                   // Datum, ISO date (YYYY-MM-DD)
  comments: string               // Kommentarer, default ''
  completion: Completion         // discriminated union, see below
  completedDate: string | null   // Färdig datum
  order: number                  // sparse ordering, see §8
  attachments: Attachment[]
  children: TaskNode[]           // empty at depth === MAX_TASK_DEPTH
  createdAt / createdBy / updatedAt / updatedBy
  custom: Record<string, unknown>   // see §9 — extension point, never remove
}
```

### Completion model

Completion differs by depth, so model it as a `z.discriminatedUnion` rather than piling optional fields onto one node. A subtask must not be able to hold a meaningless percent.

```ts
type Completion =
  | { kind: 'checkbox'
      isComplete: boolean }
  | { kind: 'percent'
      percent: number                        // integer 0..100, clamped
      isComplete: boolean                    // the override — wins outright
      percentSource: 'manual' | 'derived' }
```

Which kind a node gets is decided **by policy, not by hardcoding**, so changing it later is a config edit:

```ts
// /shared/src/config/completionPolicy.ts
export const completionPolicy: Record<number, Completion['kind']> = {
  0: 'percent',    // main tasks
  1: 'checkbox',   // subtasks
};
// depth > max defined → 'checkbox'
```

Ship `changeCompletionKind(node, kind)` in `migrations.ts` alongside it. Flipping a depth's policy is then one config line plus one migration call — not a data-model rewrite. Document this in `DECISIONS.md`.

### Rules — implement in the domain layer, never in components

**The checkbox is the sole authority on "done".** Percent is progress reporting, nothing more.
- `isTaskComplete(node)` reads `completion.isComplete` for both kinds. It is the only function anywhere that answers this question — no component inspects the union directly.
- Percent hitting 100 does **not** auto-tick the checkbox. Reaching 100% and declaring something finished are different acts, and this is a quality record.
- Ticking the override **preserves the stored percent**. A main task can be complete at 40%. Unticking restores 40% — never overwrite it with 100.
- Ticking a main task does **not** cascade to its subtasks. Their real state stays intact and visible on expand. If open subtasks remain, show a quiet inline hint (`2 open subtasks`) — inform, don't block. A "also complete all subtasks?" prompt is optional and goes behind `features.cascadeComplete`, default off.

**Derived percent.** When a main task has children, `percent` mirrors subtask completion: `round(doneChildren / totalChildren * 100)`, recomputed on every child mutation while `percentSource === 'derived'`.
- Editing the percent directly flips `percentSource` to `'manual'` and it stays there. Offer a small "back to auto" affordance that flips it back and recomputes.
- Adding a subtask to a manual main task leaves it manual — no surprise reversals.
- Zero children → derived is meaningless. Fall back to `'manual'`, default `0`.
- Deleting the last subtask while derived → switch to `'manual'` and keep the last computed value.

**`completedDate` (Färdig datum)**, one invariant for both kinds:
- `isComplete` false → true stamps today's date if `completedDate` is null
- `isComplete` true → false clears it
- it remains manually editable throughout; a user correcting the date must never have it stomped

### Rollup rule
Subtask completion counts are **derived, never stored** in the document — compute them from `children`. Only the blob *metadata* cache (§5) holds denormalised counts, and metadata is explicitly disposable.

TaskDocument {            // what actually lives in a blob
  schemaVersion: number   // starts at 1
  id: string              // === root.id
  root: TaskNode
}

Attachment {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  blobPath: string
  thumbnailPath: string | null   // client-generated, images only
  uploadedAt / uploadedBy
}
```

**Schema versioning is mandatory from day one.** Every read passes the document through `migrate(doc)` in `/shared/src/domain/migrations.ts`, which upgrades v1→v2→…→current. Ship v1 with an identity migration and a test proving the pipeline runs. This is what makes future extension cheap.

---

## 5. Blob layout

```
Container: tasks          (private)
  {taskId}.json           ← TaskDocument, whole aggregate

  Blob metadata (denormalised for the list view):
    title, date, isComplete, percent, completedDate,
    childCount, childDoneCount, attachmentCount, updatedAt

  Blob index tags (for server-side filtering):
    isComplete, date

Container: attachments    (private)
  {taskId}/{attachmentId}/{sanitizedFileName}
  {taskId}/{attachmentId}/thumb.jpg
```

Rules:
- Metadata values must be ASCII and header-safe — sanitise titles, and treat metadata as a *cache*, never as truth. Truth is inside the JSON.
- Attachment blobs are keyed by `taskId` so deleting a task can prefix-delete its files.
- Soft delete: set `deletedAt` in the document and a `deleted` index tag; a scheduled cleanup is Phase 2. Never hard-delete on user action in v1.

---

## 6. API surface

SWA-managed Functions, all under `/api`. Every handler follows the same shape: **authenticate → validate with Zod → call repository → map errors to HTTP**. No business logic in handlers; it lives in `/api/src/domain/`.

```
GET    /api/tasks                    list (filters: status, assignee, label, q)
POST   /api/tasks                    create main task
GET    /api/tasks/{id}               full aggregate; returns ETag header
PUT    /api/tasks/{id}               replace aggregate; requires If-Match
PATCH  /api/tasks/{id}               partial update; requires If-Match
DELETE /api/tasks/{id}               soft delete

POST   /api/tasks/{id}/children              add subtask     (If-Match)
PATCH  /api/tasks/{id}/children/{childId}    update subtask  (If-Match)
DELETE /api/tasks/{id}/children/{childId}    remove subtask  (If-Match)
POST   /api/tasks/{id}/reorder               reorder children (If-Match)

POST   /api/tasks/{id}/attachments/sas       → { uploadUrl, attachmentId, blobPath }
POST   /api/tasks/{id}/attachments/commit    register uploaded file (If-Match)
GET    /api/attachments/{taskId}/{attachmentId}/url  → short-lived read SAS
DELETE /api/tasks/{id}/attachments/{attachmentId}    (If-Match)

GET    /api/me                       current user from x-ms-client-principal
```

Errors: RFC 7807 problem+json. `409` for ETag conflict with `{ type: 'concurrency_conflict' }` so the client can react specifically.

---

## 7. Concurrency — get this right first

Optimistic concurrency via blob ETag. This is a correctness requirement, not a nice-to-have; two people editing subtasks on the same task is the expected case.

- `GET` returns the blob ETag in the response `ETag` header.
- Every mutation requires `If-Match`. A request without it is `428 Precondition Required` — never silently last-write-wins.
- The repository passes the ETag to Blob Storage as a conditional write. A `412` from Azure becomes a `409` to the client.
- The client keeps the ETag alongside the cached task in TanStack Query and sends it on every mutation.
- On `409` the client refetches, and if the user's pending change doesn't collide field-wise it retries **once** automatically; otherwise it shows a non-destructive "this task changed while you were editing — review" banner. Never discard the user's typing.

Write the concurrency tests in Phase 2 before building the UI: two concurrent subtask adds must both survive or one must cleanly fail — never a lost update.

---

## 8. Ordering

`order` is a sparse float. New items get `lastOrder + 1000`. Reordering sets the value midway between neighbours. When the gap between neighbours drops below `0.001`, renormalise that sibling list to whole thousands. Put this in one pure, unit-tested module (`/shared/src/domain/ordering.ts`) — do not scatter ordering maths through the UI.

---

## 9. Extension points (the "modular" requirement, made concrete)

These exist so future features don't require touching existing code:

1. **`ITaskRepository`** — the DB migration seam. §3.
2. **`custom: Record<string, unknown>`** on every node — new per-task fields without a schema migration. Register them in a `fieldRegistry` that drives rendering, so adding a field is a registry entry, not a form rewrite.
3. **`migrate()` pipeline** — versioned document evolution. §4.
4. **Domain events** — every mutation emits a typed event (`TaskCreated`, `SubtaskCompleted`, …) to an in-process `EventBus` with a no-op handler in v1. Phase 2 wires an audit log / notifications by subscribing. Do not skip this: retrofitting events later means touching every mutation.
5. **Feature flags** — `/shared/src/config/features.ts`, plain booleans. Everything in "out of scope" gets a flag defaulted to `false`.
6. **View registry** — the task list rendering goes through a `TaskViewRegistry` with one entry (`list`) in v1. Board/calendar views become registry entries later.

---

## 10. Frontend

### Stack
React 18, TypeScript strict, Vite, Tailwind, TanStack Query (server state — no Redux), React Hook Form + Zod resolver, `dnd-kit` (reordering and file-drop targets), `react-router` v6.

### Layout — desktop
Three regions:
- **Left panel** (240px, collapsible to 64px icon rail) — nav sections, task filters, counts.
- **Task list** (centre) — the spreadsheet, done properly. See columns below.
- **Detail pane** (right, opens on selection) — full task, comments editor, subtask list, attachment grid.

### Task list columns — carry these over from the sheet
Left to right, mirroring the workbook so the tool is instantly familiar:

| Column | Behaviour |
|---|---|
| Expand | Chevron, only on main tasks that have subtasks. Rotates on expand. Replaces the `Toggle` ↓ |
| Complete | Checkbox on every row. On main tasks this is the override that wins over percent. Optimistic toggle, instant feedback |
| Datum | Inline-editable date |
| Uppgift | Main task **semibold**; subtasks indented ~24px with a subtle left rule connecting them to the parent |
| Kommentarer | Truncated to one line with ellipsis, expands on click or in the detail pane. **Do not hide this column** — it is a primary field in the current workflow |
| Status | Main tasks only: percent control (below). Subtask rows leave this cell empty — their completion is the checkbox |
| Färdig datum | Read-only-looking but editable; empty until completed |
| — | Attachment count badge (paperclip + number) and subtask progress (`3/7`) as trailing affordances |

Column widths resizable and persisted to `localStorage`. Row height compact by default — this is a dense working list, not a marketing page. Sticky header on scroll.

Subtasks render **inline underneath their parent**, indented, exactly as in the sheet — not in a separate panel or modal. The "Create sub task" button becomes a `+` affordance on the parent row that appears on hover, plus a persistent button in the detail pane.

### The percent control
Slim inline progress bar with the number beside it, sized to sit comfortably in a dense row.
- Click to edit → compact number input. Arrow keys step ±5, `Shift`+arrow ±1. Clamp 0–100 on blur.
- While `percentSource === 'derived'`, show a small auto indicator and a tooltip naming the ratio it came from (`4 of 7 subtasks`). Editing it flips to manual; a subtle "auto" link flips it back.
- When the override checkbox is ticked, the bar renders full in the success colour with a completed treatment — but the **real percent stays visible** as muted text beside it (e.g. `✓ 40%`). Never let the UI imply data that isn't stored.
- Mobile: tap opens a bottom sheet with a slider plus quick-set chips (0 / 25 / 50 / 75 / 100). A 6px inline bar is not a touch target.
- `role="progressbar"` with `aria-valuenow/min/max`, and a real label when in edit mode.

### Layout — mobile
- Left panel becomes a slide-over drawer behind a hamburger; it must close on navigation.
- List and detail are **separate routes**, push-navigation style, with a back affordance. No three-column squeeze.
- Minimum 44px touch targets. Swipe-to-complete on list rows.
- Respect safe-area insets. Bottom action bar for the primary action.
- Drag-and-drop degrades to a large "Add files" button offering **camera capture** and file picker (`<input type="file" accept="image/*" capture="environment">`) — shop-floor photo capture is a real use case.

Build mobile-first in Tailwind; desktop is the `md:` and up enhancement. Verify at 360px, 768px, 1280px, 1920px.

### The left panel
The user wants this to match their **FinalInspection** app. Before building it:
1. Ask the user for the path to the FinalInspection repo.
2. Read its sidebar component, Tailwind config, and CSS custom properties.
3. Extract the design tokens (colour ramp, spacing scale, radii, type scale, shadow scale) into `/web/src/styles/tokens.css` and mirror them in `tailwind.config.ts`.
4. Rebuild the sidebar against those tokens — do not copy-paste the component; port it as a token-driven one so both apps can evolve.

If the repo isn't available, build against a neutral token set and leave a `TOKENS.md` documenting exactly which values to swap.

### Modig branding
The source workbook is Modig-branded — logo top-left, saturated cyan-blue header band (roughly `#29ABE2`). Carry the brand, not the Excel aesthetic:

- Pull the **exact** brand hex from FinalInspection's tokens rather than sampling the screenshot. Both apps must agree.
- Use the brand blue as the **accent only** — primary buttons, active nav item, focus rings, selected row. Do **not** paint a full-width saturated header band across the table; that is the single strongest "this is a spreadsheet" signal. Table headers get a neutral surface with a bottom border and muted uppercase label text.
- Logo goes in the left panel header, and it must render legibly on both light and dark surfaces. Ask for an SVG.
- Drop entirely: yellow input-cell fills, Excel dropdown-arrow chrome, heavy grid lines, the dashed page-break rule. Row separation is a 1px subtle border, nothing more.

### Modern SaaS feel — specifics, not vibes
Restrained neutral palette with one accent; a single accent colour used only for primary actions and active state. Generous whitespace, 8px spacing grid. Subtle borders over heavy shadows. 150–200ms transitions on hover/expand, and honour `prefers-reduced-motion`. Skeleton loaders, not spinners. Empty states with a real call to action. Optimistic UI on completion toggles so checkboxes feel instant. Keyboard: `/` focuses search, `n` new task, `Esc` closes detail. Full dark mode via the token layer from day one — retrofitting it is miserable.

---

## 11. Attachments pipeline

Uploads go **browser → Blob Storage directly**, never through the Function. This dodges request-size limits and keeps execution time near zero.

1. Client requests a write SAS: `POST /api/tasks/{id}/attachments/sas` with filename, contentType, sizeBytes.
2. Function validates (extension allowlist, size cap **25 MB**, MIME sniff on the declared type), generates an `attachmentId`, returns a **5-minute, write-only, single-blob** SAS.
3. Client uploads with `@azure/storage-blob` browser SDK, showing real progress; supports cancel.
4. For images, the client generates a ≤400px thumbnail on a canvas and uploads it too. No server-side image processing (that would cost money).
5. Client calls `commit` with `If-Match`; the Function verifies the blob exists and matches the declared size before adding it to the document.

Uncommitted blobs are orphans — write the cleanup as a documented Phase-2 job, and add a `// ORPHAN:` comment where they're created.

**Storage CORS** must allow the SWA origin for PUT/GET with `x-ms-blob-type` and `Content-Type` headers. Put this in the infra script, not in manual portal steps.

Drop zones: whole task-detail pane, individual subtask rows, and the attachment grid. Paste-from-clipboard (`onPaste`) for screenshots — high-value for quality work. Visual drop feedback on `dragenter`, and swallow the browser's default "navigate to file" behaviour at the window level.

Reads use short-lived (15 min) read SAS URLs fetched on demand and cached in memory. Never make containers public.

---

## 12. Auth

- SWA built-in auth, Entra ID, single tenant. Anonymous users get `401` from every route via `staticwebapp.config.json`.
- Functions read `x-ms-client-principal` (base64 JSON), parse it in **one** `getPrincipal(req)` helper, and never trust anything else from the client for identity.
- Two roles: `member` (own + shared tasks) and `admin`. Model the authorisation check as `can(principal, action, resource)` in one module even though v1 rules are trivial — this is where permissions will grow.
- No secrets in the repo. Storage credentials come from SWA application settings. `.env.example` documents every variable with a comment.

---

## 13. Infrastructure & cost

Provide `/infra` with Bicep (preferred) or an idempotent PowerShell script:
- Resource group in Sweden Central
- StorageV2, LRS, Hot, HTTPS-only, TLS 1.2+, public blob access **disabled**
- Containers `tasks` and `attachments`, both private
- CORS rules for the SWA origin
- Lifecycle policy: attachments → Cool after 60 days, → Archive after 365
- Blob soft-delete, 7-day retention (cheap insurance)
- Static Web App, Free tier
- Budget alert at €5/month

Skip Application Insights in v1 — it's the classic surprise line item. Log to Function console and note where to add it later.

Also produce `COSTS.md`: what is billed, expected monthly figure at 5 users / 2 GB, and which future feature would first break the free tier.

---

## 14. Repository layout

```
/web              React app
  /src
    /features     task-list/, task-detail/, attachments/, auth/  (vertical slices)
    /components   dumb, reusable, no feature imports
    /lib          api client, query hooks, SAS upload client
    /styles       tokens.css
/api              Azure Functions
  /src
    /functions    thin HTTP handlers
    /domain       business rules — no Azure SDK imports here
    /repositories ITaskRepository + BlobTaskRepository
    /lib          auth, problem-details, blob client factory
/shared           Zod schemas, types, ordering, migrations, feature flags
/infra            Bicep / PowerShell
/docs             ARCHITECTURE.md, COSTS.md, DECISIONS.md, TOKENS.md
```

Vertical feature slices, not `components/hooks/utils` at the top level — features get added and removed as units.

`/docs/DECISIONS.md` is an ADR log. Every non-obvious choice gets a dated entry: context, decision, consequences. Start it with the three decisions in §3.

---

## 15. Build order

Complete each phase, verify its acceptance criteria, then stop and report before continuing.

**Phase 0 — Foundations.** Repo scaffold, confirm the path is outside OneDrive, TypeScript strict, ESLint + Prettier, Vitest, shared package wired into both web and api. Run the §2 verification and report. *Done when:* `npm run build`, `lint`, and `test` all pass from PowerShell on an empty project.

**Phase 1 — Domain + storage.** Zod schemas, migration pipeline, ordering module, completion model + policy, `ITaskRepository`, `BlobTaskRepository`, plus an `InMemoryTaskRepository` for tests. *Done when:* unit tests cover ordering, migrations, tree operations, and every completion rule in §4 at ≥80%, with no UI written. The completion tests must specifically prove: the override preserves the stored percent across tick/untick, 100% does not auto-tick, derived→manual is one-way until explicitly reset, and completing a parent leaves child state untouched.

**Phase 2 — API + concurrency.** All endpoints, auth helper, problem-details errors. *Done when:* integration tests against Azurite prove conditional writes — concurrent mutation produces exactly one 409, no lost update.

**Phase 3 — Infrastructure.** Bicep, deploy to Azure, CI via GitHub Actions. *Done when:* the API responds in the cloud behind Entra ID login.

**Phase 4 — Core UI.** Shell + left panel, task list, create/edit, subtasks, completion, ETag handling with the conflict banner. *Done when:* the full loop works on desktop and at 360px.

**Phase 5 — Attachments.** SAS flow, drag-and-drop, paste, mobile camera, thumbnails, progress, cancel. *Done when:* a 20 MB PDF and a pasted screenshot both round-trip on desktop and phone.

**Phase 6 — Polish.** Dark mode, keyboard shortcuts, skeletons, empty states, a11y pass (focus traps, labels, contrast), Lighthouse ≥ 90 on mobile.

---

## 16. Working agreement

- **Ask before assuming** on anything user-facing or architectural. A wrong assumption compounds across phases.
- **No stubs presented as finished.** If something is incomplete, say so explicitly in the phase report.
- **No new dependencies** without naming what they replace and their bundle cost.
- Small, focused commits with conventional-commit messages.
- Every phase report: what was built, what was skipped, what you're uncertain about, what you need from the user.
- If a requirement in this document turns out to be wrong or impossible, **stop and say so** rather than routing around it silently.

---

## 17. Open questions — answer these before Phase 1

1. **Derived vs manual percent — confirm the default.** §4 assumes a main task's percent auto-mirrors its subtask ratio until the user edits it by hand. The original workbook had percent as a plain manual input cell, so if you'd rather it stay manual always, that's one line in the domain layer — but say so before Phase 1 so the tests are written against the right behaviour.
2. **UI language.** The workbook is Swedish (`Uppgift`, `Kommentarer`, `Färdig datum`). Swedish-only, English-only, or both? If both, wire `react-i18next` in Phase 0 with `sv` as default — retrofitting i18n after Phase 4 means touching every component. If Swedish-only, still route all strings through a single `strings.ts` rather than hardcoding them in JSX.
3. **Single-user or team?** No assignee column exists in the sheet, which hints at a personal or very small-team tool. If personal, auth simplifies — but keep the ETag layer regardless; it is cheap now and expensive to retrofit.
4. **Task grouping.** Is there a level above "main task" — projects, machines, customers, machine serial numbers? If so, say now; it changes the blob layout and the left panel.
5. **FinalInspection repo path**, for token extraction and the exact brand hex (§10).
6. **`Datum` meaning.** Is it the date the task was raised, or a planned/target date? This determines whether it is auto-set and read-only, or a primary editable field with overdue highlighting.
7. **Migrating existing data.** Are there live workbooks with real tasks to import? If yes, a one-off `xlsx`→JSON import script belongs in Phase 1, not bolted on later.
