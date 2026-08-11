# COSTS.md — what TaskHub actually costs to run

Scope: the v1 footprint described in the spec, §13. Azure Static Web Apps (Free) plus one
StorageV2 / LRS / Hot account in Sweden Central. No database, no Application Insights, no
standing compute charge.

---

## 0. Accuracy warning — read this first

**Every price in this document is an estimate from general knowledge. None of it was verified
against live Microsoft pricing.** The environment these docs were written in blocks outbound
access to `learn.microsoft.com` and `azure.microsoft.com`, so the Sweden Central price sheet
could not be opened.

What that means in practice:

- Unit prices are stated as _Sweden Central list, EUR, ex-VAT_ because that is the intended
  region, but they are recalled figures, not quoted ones. Individual unit prices could be wrong
  by tens of percent.
- Prices also drift. Azure changes list prices, and EUR pricing moves with Microsoft's periodic
  FX resets independently of the USD sheet.
- Enterprise Agreement, CSP and MACC discounts are not modelled at all.

**Before anyone relies on these numbers — a budget approval, a customer quote, an internal
sign-off — re-run the arithmetic below in the
[Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) with Sweden Central
selected, and correct this file.** The arithmetic in §2 is deliberately shown line by line and
the assumptions are stated explicitly, so swapping in real unit prices is a five-minute job, not
a rebuild.

The _shape_ of the result — that storage-at-rest dominates, that transactions are noise at this
scale, that egress is free below the monthly allowance — is robust and will survive price
corrections. The absolute figure is not.

---

## 1. What is billed

Every line item this architecture actually touches. Anything not in this table is not billed
because the architecture does not use it.

| Line item                                      | Unit                    | Est. unit price (Sweden Central, EUR, ex-VAT) | Notes                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure Static Web Apps, Free tier               | per app / month         | **€0.00**                                     | No per-app charge. Includes SWA-managed Functions, TLS certs, custom domains, and 100 GB/month bandwidth                                                                |
| SWA-managed Azure Functions                    | per execution           | **€0.00**                                     | Billed as part of SWA Free, not as a separate Functions app. There is no App Service plan and no Consumption meter                                                      |
| Storage — data at rest, Hot LRS                | per GB / month          | ~€0.0180                                      | First 50 TB band. Charged on average GB over the month, not peak                                                                                                        |
| Storage — write transactions                   | per 10,000 ops          | ~€0.05                                        | `PutBlob`, `PutBlock`, `PutBlockList`, `SetBlobMetadata`, `SetBlobTags`                                                                                                 |
| Storage — list / create-container transactions | per 10,000 ops          | ~€0.05                                        | `ListBlobs` is billed at the _write_ rate, not the read rate. This matters — see §3                                                                                     |
| Storage — read transactions                    | per 10,000 ops          | ~€0.004                                       | `GetBlob`, `GetBlobProperties`, `GetBlobTags`                                                                                                                           |
| Storage — all other transactions               | per 10,000 ops          | ~€0.004                                       | `Delete` is free                                                                                                                                                        |
| Storage — blob index tags                      | per 10,000 tags / month | ~€0.03                                        | **Billed separately, per tag, per month, for as long as the tag exists.** Two tags on one blob is two billable tags. This is a standing charge, not a per-operation one |
| Storage — data retrieval (Hot)                 | per GB                  | **€0.00**                                     | Free on Hot. Cool retrieval is ~€0.01/GB, Archive far more — see §5                                                                                                     |
| Bandwidth — egress from Storage to internet    | per GB                  | ~€0.075 after allowance                       | **First 100 GB/month free**, subscription-wide, across all Azure services. Only the excess is billed                                                                    |
| Bandwidth — SWA egress                         | per GB                  | included                                      | Counted against SWA Free's own 100 GB/month allowance, separate from the Azure-wide egress allowance                                                                    |

Explicitly **not** billed in v1: Application Insights, Log Analytics, Azure AI Search, any
database, any Functions Premium/App Service plan, geo-replication (LRS only), private endpoints,
Defender for Storage, reserved capacity.

One easy misconception to head off: **generating a SAS token is a local cryptographic operation.
It costs nothing and produces no storage transaction.** Only the client's subsequent `PUT` or
`GET` against the blob is billed.

---

## 2. Expected monthly cost at the stated baseline

### 2.1 Assumptions

These are the numbers the arithmetic uses. Change them here and the lines below follow.

| Assumption                      | Value                                     | Basis                                             |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| Users                           | 5                                         | Stated baseline                                   |
| Attachments at rest             | 2.00 GB                                   | Stated baseline                                   |
| Client-generated thumbnails     | ~1,500 images x 25 KB = 0.037 GB          | ≤400 px JPEG, spec §11                            |
| Main tasks                      | 500                                       | Stated baseline                                   |
| Subtasks                        | ~5 per main task, stored in the same blob | Spec §3, decision 1                               |
| Size of one `TaskDocument` blob | ~6 KB                                     | Title, comments, 5 subtasks, attachment records   |
| Task writes                     | 50 / day = 1,500 / month                  | Stated baseline. 30-day month                     |
| Attachment uploads              | 30 / month                                | Growth of roughly 150 MB/month on a 2 GB base     |
| List-view loads                 | 15 / user / day                           | ~6 app opens plus TanStack Query refetch-on-focus |
| Task detail opens               | 25 / user / day                           |                                                   |
| Thumbnail fetches               | 40 / user / day                           | Attachment grid in the detail pane                |
| Full attachment downloads       | 300 / month                               | Across all users                                  |

### 2.2 Line-by-line arithmetic

**Azure Static Web Apps, Free tier**

```
Flat charge                                        = €0.0000
```

**Storage — data at rest**

```
attachments                                2.000 GB
thumbnails            1,500 x 25 KB      = 0.037 GB
task documents          500 x  6 KB      = 0.003 GB
                                          ---------
total                                      2.040 GB

2.040 GB x €0.0180 / GB / month                    = €0.0367
```

**Storage — write and list transactions** (both billed at ~€0.05 / 10,000)

```
task writes (PutBlob)          50/day x 30 days  =  1,500 ops
attachment uploads + thumbs    ~5 ops x 30       =    150 ops
list-view loads (ListBlobs)    5 x 15 x 30       =  2,250 ops
create-time ListBlobs          10/day x 30       =    300 ops
                                                    ---------
total                                              4,200 ops

4,200 / 10,000 x €0.05                             = €0.021
```

Note the shape here: **the list view, not the writing of tasks, is the largest transaction
consumer** — and `ListBlobs` is billed at the expensive write rate. One `ListBlobs` call returns
up to 5,000 blobs, so 500 tasks is a single billable operation per load; that is exactly the
efficiency the "no index blob" decision (spec §3) was bought for.

The `create-time ListBlobs` line is the one addition manual ordering made: a new task reads the
existing summaries to work out where the end of the list is (ADR-0034). At ten new tasks a day
that is 300 operations a month, about €0.0015 — a rounding error against a bill dominated by
storage at rest. Dragging a task is one `PutBlob` and is already inside the task-writes line; the
renumbering case writes one blob per task, and needs roughly twenty drops into the same gap before
it happens at all.

**Storage — read transactions** (~€0.004 / 10,000)

```
read-before-write on PATCH                        =  1,500 ops
task detail opens         5 x 25 x 30             =  3,750 ops
thumbnail GETs            5 x 40 x 30             =  6,000 ops
full attachment downloads                         =    300 ops
                                                    ---------
total                                              11,550 ops

11,550 / 10,000 x €0.004                           = €0.0046
```

**Storage — other transactions** (~€0.004 / 10,000)

```
GetBlobProperties, SetBlobMetadata, deletes, etc.
~5,000 ops / 10,000 x €0.004                       = €0.0020
```

**Storage — blob index tags**

```
2 tags per task blob (isComplete, date) x 500 blobs = 1,000 tag-months
1,000 / 10,000 x €0.03                             = €0.0030
```

**Bandwidth / egress**

```
attachment downloads   300 x ~3 MB       ≈ 0.90 GB
thumbnail + app traffic                  ≈ 0.60 GB
                                          ---------
total egress                             ≈ 1.50 GB

1.50 GB is inside the 100 GB/month free allowance  = €0.0000
```

### 2.3 Total

| Line                                | Est. EUR / month |
| ----------------------------------- | ---------------: |
| Static Web Apps (Free)              |           0.0000 |
| Storage — data at rest              |           0.0367 |
| Storage — write + list transactions |           0.0210 |
| Storage — read transactions         |           0.0046 |
| Storage — other transactions        |           0.0020 |
| Storage — blob index tags           |           0.0030 |
| Bandwidth / egress                  |           0.0000 |
| **Total**                           |     **≈ €0.067** |

**Call it under €0.15/month including headroom for the price uncertainty in §0.** The spec's
target of under €2/month is met with roughly an order of magnitude to spare.

Two honest caveats on that number:

1. At this scale the bill is effectively rounding noise. Do not over-interpret it — the point of
   this exercise is to know _which_ line grows, not to defend two decimal places.
2. Storage-at-rest is ~55% of the total and scales linearly with attachment volume. It is the
   only line that matters as the app is used in anger.

---

## 3. Sensitivity — what actually moves the number

| Change                                                  | Effect on the monthly bill                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Attachments grow 2 GB → 20 GB                           | at-rest goes €0.037 → €0.36. Total ≈ €0.39                                                                                                                                                       |
| Attachments grow 2 GB → 100 GB                          | at-rest goes €0.037 → €1.80. Total ≈ €1.83, i.e. the €2 target is reached at roughly 100 GB of attachments                                                                                       |
| Tasks grow 500 → 1,000                                  | Negligible (~€0.003 more in tags, no change in list ops). The real limit at 1,000 tasks is _latency_, not cost — see the `// SCALE:` marker in the listing call                                  |
| **TanStack Query set to a 30-second `refetchInterval`** | 5 users x 8 h x 22 days = ~105,600 `ListBlobs` ops = **€0.53/month**, an 8x increase in the total bill for zero user-visible benefit. Prefer `refetchOnWindowFocus` and invalidation-on-mutation |
| Egress exceeds 100 GB/month                             | Every GB above the allowance costs ~€0.075. 100 GB is roughly 33,000 attachment downloads at 3 MB                                                                                                |
| Switching LRS → ZRS or GRS                              | Roughly +25% and +100% on the at-rest line respectively. Not needed for v1; LRS is the stated constraint                                                                                         |

The single cheapest cost-control decision in the whole project is _not polling_.

---

## 4. What would first break the free tier

### 4.1 The SWA Free limits, and why they are unlikely to bind

| Limit                   | Free tier        | Where TaskHub sits                                                                                                                                              |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bandwidth               | 100 GB / month   | The app shell is ~1 MB gzipped and API responses are small JSON. Even at 3,000 list calls/month at ~150 KB each, that is under 1 GB. **Roughly 100x headroom.** |
| App size per deployment | 0.5 GB           | A Vite production build of this app is single-digit MB. **Effectively unreachable.**                                                                            |
| Custom domains          | 2                | One is needed                                                                                                                                                   |
| SLA                     | none on Free     | An accepted risk for an internal tool                                                                                                                           |
| Functions               | SWA-managed only | Bring-your-own Functions requires Standard — see 4.3                                                                                                            |

Both bandwidth and app-size figures above should be re-checked in the published SWA quota table;
the app-size cap in particular has been documented at different values (250 MB has appeared for
Free, 500 MB for Standard) and this file carries 0.5 GB from the project notes. It makes no
practical difference — the build is nowhere near either figure — but do not quote it externally
without checking.

### 4.2 The one that catches people out: attachment traffic is not SWA traffic

**Attachment downloads are served by Blob Storage via short-lived SAS URLs. The bytes go
browser ↔ Storage account and never traverse Static Web Apps.** Therefore:

- Attachment downloads **do not** consume SWA Free's 100 GB/month bandwidth allowance.
- They consume **Storage egress**, which has its own, separate, Azure-wide 100 GB/month free
  allowance shared with everything else in the subscription.
- The same is true of uploads, which go browser → Storage directly by design (spec §11).
  Inbound data transfer to Azure is free regardless.

The practical consequence: **SWA Free's bandwidth cap is very unlikely to be the thing that
breaks first.** Heavy attachment use shows up on the Storage bill, not as an SWA overage. Anyone
reasoning about "will we blow the free tier" by watching the SWA metrics blade is looking at the
wrong meter.

The corollary is also worth stating: because the free egress allowance is _subscription-wide_,
another unrelated workload in the same subscription can consume it and push TaskHub's attachment
traffic into billable territory without TaskHub changing at all.

### 4.3 Future features, roughly in the order they would bite

Ordered by when they are likely to be hit, with the honest note that the _largest_ cost is not
the _earliest_ one.

| #   | Feature                                                  | What it adds                                                                                                                                                                                                                                                                                                                                        | Rough est.                                                                                                                               |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Thumbnails at scale**                                  | Client-side thumbnailing (v1) is free — the cost is only the extra blob per image: more at-rest GB, one extra write op and one extra read op per image. Cheap and linear. It only becomes expensive if thumbnailing moves _server-side_, which SWA-managed Functions are not sized for and which pushes you to 5                                    | +€0.01–0.10 / month as an extra blob; a tier change if moved server-side                                                                 |
| 2   | **Full-text search across tasks or attachment contents** | Blob listing cannot do this. Either scan every blob on every query (read ops plus egress, and unacceptably slow past a few hundred tasks) or add Azure AI Search. The Free search tier is capacity-limited and unsuitable for production; Basic is a real standing charge                                                                           | Azure AI Search Basic ≈ **€70+/month** — by far the biggest single jump on this list, and the reason it is explicitly out of scope in v1 |
| 3   | **Application Insights**                                 | Ingestion-priced. The free grant covers the first 5 GB/month, after which it is roughly €2.30/GB. A chatty Functions app with default sampling can produce several GB/month without anyone noticing                                                                                                                                                 | €0 while under the grant, then €2–10 / month. The classic surprise line item                                                             |
| 4   | **A real database**                                      | Table Storage (the documented Phase-2 path) is nearly free — cents per GB plus transactions — and is the right first move. Cosmos DB serverless is inexpensive at this scale but is a per-RU meter that grows with traffic. Azure SQL is the expensive option: even Basic/serverless carries a floor of several euros per month whether used or not | Table Storage +€0.05; Cosmos serverless €1–5; Azure SQL **€5–15/month floor**                                                            |
| 5   | **Moving to SWA Standard**                               | Required if the §2 verification concludes that single-tenant Entra ID needs a custom OIDC provider, and also the gate for bring-your-own Functions, private endpoints and an SLA. A flat per-app charge that is instantly larger than the entire storage bill                                                                                       | ≈ **€9 / app / month**, i.e. roughly 130x the current total                                                                              |

**The ordering caveat that matters most:** item 5 is listed last because it is a deliberate
architectural upgrade, but it will bite _first_ — before a single feature is built — if the §2
verification comes back saying Entra ID single-tenant is unavailable on SWA Free. That check is
flagged in the spec as a cost-decision blocker precisely because it inverts this table. Resolve
it before Phase 1 and, if the answer is "Standard required", rewrite §2.3 of this document with
€9/month as the floor and re-evaluate whether the sub-€2 target is still the right target.

---

## 5. Cost guardrails

Five deliberate decisions that keep this bill boring. All belong in `/infra`, not in manual
portal steps.

**1. Budget alert at €5/month.** Set on the resource group. €5 is roughly 75x the expected spend,
so it is not a spending limit — it is an _anomaly detector_. If it ever fires, something is
structurally wrong (a runaway polling loop, an unexpected egress consumer, a resource created by
hand outside the Bicep template), and the right response is to investigate rather than to raise
the threshold. Note that Azure budget alerts notify; they do not cap. Nothing stops spend
automatically.

**2. Lifecycle policy: attachments → Cool at 60 days, → Archive at 365 days.** Cool is roughly
half the at-rest price of Hot; Archive is roughly a tenth of Cool. At today's 2 GB the policy
saves around €0.02/month, which is nothing — its value is that the discipline is already in place
when the account holds 50 GB of shop-floor photographs and the saving is real.

Three consequences that must be understood before this policy is trusted:

- Cool carries a **30-day early-deletion charge** and a **~€0.01/GB retrieval charge**. Blobs that
  are deleted or re-read frequently can cost _more_ on Cool than on Hot. 60 days is a
  conservative threshold for that reason.
- **Archive is offline storage.** An archived blob cannot be read by a `GET`, SAS or otherwise —
  the request fails with `BlobArchived`, and rehydration to an online tier takes hours and costs
  a per-GB retrieval fee. 365 days is set deliberately long so this is rare.
- **Open item:** the spec does not define what the UI does when a user clicks an archived
  attachment. Until that is designed, the honest position is that attachments older than a year
  are cold-archive backups, not clickable files. This needs a decision before Phase 5 ships, and
  an ADR entry in `DECISIONS.md`.

**3. Blob soft-delete, 7-day retention.** Cheap insurance against a bad `DELETE` or a bug in the
prefix-delete path that removes a task's attachments. Soft-deleted blobs continue to be billed at
their tier for the retention window, so the cost is 7 days of storage on whatever was deleted —
pennies at this scale, and far cheaper than losing a quality record. This is separate from, and
complementary to, the application-level soft delete (`deletedAt` plus a `deleted` index tag) in
spec §5: the application flag is for user-visible undo, blob soft-delete is for operator recovery.

**4. Application Insights deliberately skipped in v1.** It is the classic surprise line item on
an otherwise sub-euro bill: ingestion-priced, free only to 5 GB/month, and a chatty Functions app
with default sampling can quietly cross that. It also cannot be added blind — it needs a sampling
and retention configuration to be safe, and that configuration is not worth designing before
there is production traffic to shape it against.

The tradeoff being accepted is real and should be stated plainly: **without App Insights there is
no distributed tracing, no failure aggregation and no alerting.** Diagnosis relies on Function
console logging. Log with structure (a correlation id per request, the task id, the outcome) from
day one so that wiring App Insights later is a configuration change rather than a logging rewrite,
and leave a `// OBSERVABILITY:` comment at the Function entry point marking the insertion point.
Revisit this the first time a production bug cannot be reproduced from console logs alone.

**5. No standing compute.** There is no App Service plan, no Functions Premium plan, no
always-on anything. Every euro on this bill is proportional to data actually stored or moved. Keep
it that way: any proposal that introduces a fixed monthly charge should be weighed against the
fact that the entire current footprint costs less than a cup of coffee per year.

---

## 6. Before relying on any of this

- [ ] Re-quote every unit price in §1 in the Azure Pricing Calculator with **Sweden Central**
      selected and EUR as the currency, and correct this file.
- [ ] Confirm the Storage egress free allowance is still 100 GB/month and still subscription-wide.
- [ ] Confirm the SWA Free quota table: bandwidth and app-size cap (§4.1).
- [ ] Resolve the spec §2 question on Entra ID single-tenant on SWA Free. If Standard is required,
      §2.3 and §4.3 both change materially.
- [ ] Check whether VAT applies to the billing account; all figures here are ex-VAT.
- [ ] After one month in production, compare the actual invoice against §2.3 and update the
      assumptions in §2.1 rather than the totals.
