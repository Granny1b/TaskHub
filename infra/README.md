# Infrastructure

Everything TaskHub runs on, as Bicep. One subscription-scoped deployment creates
the resource group, storage account, Static Web App and budget alert.

## What gets created

| Resource         | Details                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| Resource group   | `rg-taskhub-prod`, Sweden Central                                      |
| Storage account  | StorageV2, LRS, Hot, HTTPS-only, TLS 1.2+, public blob access disabled |
| Containers       | `tasks` and `attachments`, both private                                |
| Blob soft-delete | 7 days, containers and blobs                                           |
| CORS             | The app's origin plus `localhost:5173`, for direct browser uploads     |
| Lifecycle policy | Attachments → Cool after 60 days (Archive off by default, see below)   |
| Static Web App   | Free tier, West Europe                                                 |
| Budget alert     | EUR 5/month, at 80%, 100% and forecast                                 |

No Application Insights — the classic surprise line item. Functions log to the
console; add it when there is a reason to pay for it.

## Prerequisites

- Azure CLI (`az`), logged in with rights to create resource groups
- A subscription where budget creation is permitted

## Deploying

```powershell
cd infra

# 1. Set your budget alert address and allowlist.
#    The script refuses to run while the placeholder is still there.
notepad main.bicepparam

# 2. Look before you leap.
./deploy.ps1 -WhatIf

# 3. Deploy. Safe to re-run; it converges rather than duplicating.
./deploy.ps1
```

The script prints the app URL and the two follow-up commands you need.

## After the first deployment

**1. Wire up GitHub deployments.**

```powershell
az staticwebapp secrets list --name swa-taskhub-prod --query "properties.apiKey" -o tsv
```

Add that value as a repository secret named `AZURE_STATIC_WEB_APPS_API_TOKEN`.
`.github/workflows/deploy.yml` then deploys on every push to `main`.

**2. Confirm the allowlist is set.**

```powershell
az staticwebapp appsettings list --name swa-taskhub-prod
```

`TASKHUB_ALLOWED_DOMAINS` must be non-empty. This matters more than it looks:
on the Free tier the built-in Entra provider cannot be restricted to one tenant,
so **any Microsoft account can complete the login**, and this allowlist is the
only thing that stops them getting data. If both allowlist settings are empty
the API denies everyone — deliberately, so a misconfigured deploy locks you out
rather than silently publishing the company's task list. See ADR-0017.

**3. Sign in and confirm you get past it.** If you are locked out, the domain in
your UPN does not match what you configured.

## Decisions worth knowing about

**The Static Web App is in West Europe, not Sweden Central.** Storage — where
all task data and attachments live — is in Sweden Central as specified. The SWA
resource decides only where the managed Functions run; static assets are
globally distributed either way. West Europe is used because it is
unambiguously a supported Static Web Apps region and sources disagreed about
Sweden Central. Both are EU regions, so data residency holds. If you want the
API in Sweden too, change `staticWebAppLocation` and redeploy — an unsupported
region is rejected before anything is created, so trying costs nothing.

**The Archive tier is off by default**, despite the spec asking for
attachments to archive after a year. An archived blob cannot be served by a read
SAS: the request fails with `BlobArchived` and rehydration takes hours. Turning
it on today would silently break viewing any attachment older than a year. Set
`enableArchiveTier = true` once the UI has an "archived — request restore"
state. See ADR-0021. The saving forgone is a fraction of a euro per month at the
projected volume.

**`allowSharedKeyAccess` is deliberately true.** SWA-managed Functions cannot
use managed identity to reach storage, so the API authenticates with a
connection string, and attachment SAS signing needs the shared key. Disabling it
breaks both. See ADR-0010 and `docs/VERIFICATION.md` §3.

**Free tier has no staging environments**, so `stagingEnvironmentPolicy` is
`Disabled` and pull requests get no preview deployments.

## Tearing it down

```powershell
az group delete --name rg-taskhub-prod --yes
```

This destroys all task data. Blob soft-delete does not survive deleting the
account.
