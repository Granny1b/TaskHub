# TaskHub

Multi-user task management for Modig Machine Tool. A main task, subtasks under
it, completion tracking, and file attachments — on a desktop browser and on a
phone.

Runs on Azure Static Web Apps (Free) with Blob Storage and **no database**,
architected so a database can be added later without rewriting the domain or the
UI.

- **What it is and why:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Why each choice was made:** [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **What Azure actually supports:** [`docs/VERIFICATION.md`](docs/VERIFICATION.md)
- **What it costs:** [`docs/COSTS.md`](docs/COSTS.md)
- **Design tokens and how to swap them:** [`docs/TOKENS.md`](docs/TOKENS.md)
- **The full specification:** [`TASKHUB_CLAUDE_CODE_PROMPT.md`](TASKHUB_CLAUDE_CODE_PROMPT.md)

## Status

| Phase                 | State       |
| --------------------- | ----------- |
| 0 — Foundations       | Complete    |
| 1 — Domain + storage  | Complete    |
| 2 — API + concurrency | Not started |
| 3 — Infrastructure    | Not started |
| 4 — Core UI           | Not started |
| 5 — Attachments       | Not started |
| 6 — Polish            | Not started |

The frontend is currently a scaffold that proves the token layer, i18n and the
shared-package import work. The real UI is Phase 4.

## Requirements

- **Node 20 or newer** (`.nvmrc` pins 20; the runtime target is Node 20 because
  that is what SWA-managed Functions run).
- **Windows-native development is supported.** Every npm script runs unmodified
  in PowerShell 5.1 — no `&&` chaining, no `rm -rf`, no `VAR=value` prefixes.
  Anything needing more than one step is a Node script in `scripts/`.
- **Do not clone into a OneDrive-synced folder.** File locking and delayed
  writes break `node_modules` and the Functions host in ways that look like
  random build failures. Check the path before cloning.

## Getting started

```powershell
npm install
npm run verify
```

`verify` runs the four gates in order: formatting, lint, strict type build,
tests. It is the single command that says whether the repository is healthy.

### Everyday scripts

| Script                      | Does                                               |
| --------------------------- | -------------------------------------------------- |
| `npm run verify`            | All gates. Use this before committing.             |
| `npm run dev`               | Vite dev server on :5173, proxying `/api` to :7071 |
| `npm run dev:api`           | Azure Functions host (needs Core Tools + Azurite)  |
| `npm test`                  | Vitest once                                        |
| `npm run test:watch`        | Vitest in watch mode                               |
| `npm run test:coverage`     | Coverage, with the domain threshold enforced       |
| `npm run lint` / `lint:fix` | ESLint, including architectural boundary rules     |
| `npm run typecheck`         | `tsc --build` across all three packages            |
| `npm run format`            | Prettier write                                     |
| `npm run clean`             | Remove build output (cross-platform)               |

### Local API against the blob emulator

```powershell
npm install -g azure-functions-core-tools@4
npx azurite --silent --location ./.azurite
copy api\local.settings.json.example api\local.settings.json
npm run dev:api
```

`local.settings.json` is gitignored. See `.env.example` for every variable and
what it is for.

## Layout

```
/web        React app — features/ (vertical slices), components/, lib/, styles/
/api        Azure Functions — functions/ (thin handlers), domain/, repositories/, lib/
/shared     Zod schemas, domain rules, config. Imported by both. Platform-neutral.
/docs       Architecture, decisions, verification, costs, tokens
/scripts    Cross-platform build helpers
```

Vertical feature slices rather than top-level `components/hooks/utils`, because
features get added and removed as units.

## The rules that matter

A few conventions carry more weight than the rest. All three are enforced by
ESLint rather than by review:

1. **Nothing above `api/src/repositories/` imports the Azure SDK.** Storage is
   reached through `ITaskRepository`. This is what makes a future database a
   one-file change.
2. **`/shared` imports no Node built-ins.** It is bundled into the browser.
3. **`web/src/components/` never imports a feature.** Dumb components take
   props.

And one that a linter cannot check: **the checkbox is the sole authority on
"done"**. `isTaskComplete()` is the only function anywhere that answers that
question — no component inspects the completion union directly.

## Testing

228 tests, with the domain layer above 95% statement coverage against an
enforced 80% threshold. The suite is the executable form of the specification:
`completion.test.ts` in particular states each rule from §4 as its own case,
including the four invariants the build order calls out by name.

```powershell
npm run test:coverage
```
