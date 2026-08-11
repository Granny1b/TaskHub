# Azure platform verification

Spec §2 requires that Azure specifics are checked against current documentation
before any code depends on them, and reported as _confirmed / changed / blocked_.

**Date checked:** 11 August 2026.

**Method and its limits — read this before relying on anything below.** The
development environment's network egress policy blocks `learn.microsoft.com` and
`docs.azure.cn`, so the primary documentation pages could not be fetched
directly. The findings below come from web search results that quote and
summarise those pages, cross-checked across several independent sources where
they disagreed. That is weaker evidence than reading the doc, so each finding
carries an explicit confidence level. **Every item marked medium confidence
should be re-checked in the Azure portal before money or an architecture
decision rides on it** — most cheaply by attempting the configuration and seeing
whether the portal offers it.

---

## 1. SWA Free tier + Entra ID built-in auth — CHANGED (cost decision required)

**Confidence: medium-high.** Multiple independent sources agree, and they agree
on the mechanism, not just the conclusion.

The situation is more nuanced than the spec's binary framing, and the nuance is
the whole story:

| What                                          | Free plan         | Standard plan |
| --------------------------------------------- | ----------------- | ------------- |
| Built-in ("pre-configured") Entra ID provider | Available         | Available     |
| Sign-in restricted to the Modig tenant only   | **Not available** | Available     |
| Custom OIDC provider registration             | **Not available** | Available     |

The pre-configured Entra ID provider **works on Free**, so the spec's core
assumption survives. But it authenticates against the multi-tenant `common`
endpoint: _any_ Microsoft work, school or personal account can complete the
login. Restricting sign-in to a single tenant requires registering a custom
OIDC provider with a tenant-specific `openIdIssuer`, and **custom authentication
is a Standard-plan feature**.

Standard is roughly **$9/month flat**, which is several times the entire
projected running cost in `COSTS.md` and breaks the "< €2/month" target outright.

### Recommended mitigation, and what it costs you

Stay on Free and treat authentication and authorisation as separate concerns:

- Anyone with a Microsoft account can _authenticate_.
- Nobody is _authorised_ until the API says so. `getPrincipal(req)` resolves the
  Entra object id, and `can(principal, action, resource)` checks it against an
  allowlist held in SWA application settings. Everyone else gets `403` from
  every route, including `/api/me`.

This keeps the free tier and the security outcome that matters — no outsider
reads or writes Modig data. What it does **not** give you is a closed front
door: an outsider can reach the login page and get a rejection, and their
object id is briefly known to the app. For an internal task tracker that is a
reasonable trade; for anything holding regulated data it would not be.

**This is a decision for the user, not for the code.** Nothing built so far
depends on which way it goes — the `can()` seam is needed either way. Flag it
before Phase 3 (infrastructure), which is where the plan tier gets chosen.

## 2. SWA-managed Functions on Free — CONFIRMED with caveats

**Confidence: medium-high on runtime, medium on the limits.**

- **Node 20 is supported** and has been the default for managed Functions since
  late 2024. Selected explicitly via `platform.apiRuntime: "node:20"` in
  `staticwebapp.config.json` — already set.
- **HTTP triggers only.** Timers, queues and Durable Functions need a
  bring-your-own Functions app. This matters for two things the spec defers to
  Phase 2: orphan-attachment cleanup and the projection blob both assume a
  queue or timer trigger, so **both need a separate Functions app or a GitHub
  Actions schedule**. Worth knowing now; it does not affect v1.
- **Timeout:** the platform caps an HTTP-triggered function's response at
  **230 seconds** regardless of any `functionTimeout` setting. Every operation
  in this design is a single small blob read or write, so this is nowhere near
  binding.
- **Request body size:** could not be confirmed for SWA-managed Functions
  specifically. (The "100 MB" figure that surfaces in search results is the
  _deployment package_ limit, not a request limit — do not conflate them.)
  **This is not on our critical path by design:** attachments upload from the
  browser straight to Blob Storage via SAS and never pass through a Function
  (§11), so the largest request the API ever sees is a JSON task document.

## 3. Managed identity from SWA-managed Functions to Blob Storage — BLOCKED

**Confidence: high.** This is stated directly in the Static Web Apps FAQ and
was consistent across every source.

Static Web Apps supports managed identity **only for retrieving secrets from
Key Vault**, not for the managed API to authenticate to other Azure services.
Microsoft's own guidance: if you need managed identity or Key Vault references
in your API, use the "bring your own Functions app" feature instead.

**Fallback taken — exactly the one the spec anticipated (§2.3):** a storage
connection string in SWA application settings.

The tradeoff, stated plainly:

- A long-lived shared credential exists. It is not in the repository and not in
  the bundle, but it is a secret in configuration, and rotating it is a manual
  step against the storage account's access keys.
- Compromise of the SWA configuration means full access to both containers.

`api/src/lib/blobClient.ts` implements **both** credential paths and picks by
configuration: set `AZURE_STORAGE_ACCOUNT_URL` and it uses
`DefaultAzureCredential`; set `AZURE_STORAGE_CONNECTION_STRING` and it uses the
key. So the day the API moves to a standalone Functions app, this becomes an app
setting change rather than a code change. See ADR-0010.

## 4. Blob index tags on StorageV2 LRS — CONFIRMED

**Confidence: high.**

- Supported on general-purpose v2 accounts, which is what the spec specifies.
  LRS is fine; redundancy mode is unrelated to tag support.
- **Limit: 10 tags per blob**, tag keys up to 128 characters, values up to 256.
- Tag values are restricted to alphanumerics plus a small punctuation set
  (space `+` `-` `.` `/` `:` `=` `_`). ULIDs and ISO dates fall inside that set,
  so nothing we store needs escaping.

We write **four** tags — `isComplete`, `date`, `listId`, `deleted` — leaving six
spare. `shared/src/domain/metadata.test.ts` asserts both the count and the
character set so a future addition cannot silently exceed either.

Note that index tags are billed per tag per month. At this scale it rounds to
nothing, but `COSTS.md` records it as a line item rather than pretending it is
free.

---

## Items that still need a human

1. **The plan-tier decision in item 1** — the only finding that changes the
   architecture or the bill. Needed before Phase 3.
2. **Re-check items 1 and 2 in the portal** when convenient, given the egress
   limitation described above.
3. **Archived attachments have no defined behaviour.** The lifecycle policy in
   §13 moves attachments to Archive after 365 days, but an archived blob cannot
   be served by a read SAS — the request fails with `BlobArchived` and
   rehydration takes hours. Either the UI needs an "archived, request restore"
   state, or the Archive step should be dropped and attachments left in Cool.
   Surfaced while writing `COSTS.md`; not yet decided.
