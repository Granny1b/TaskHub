using './main.bicep'

/*
  Deployment parameters.

  Nothing secret belongs in this file — it is committed. The storage key is
  never a parameter; it is read from the account at deployment time and written
  straight into the Static Web App's settings.
*/

param environmentName = 'prod'
param baseName = 'taskhub'

// Task data lives in Sweden Central.
param location = 'swedencentral'

// The Static Web App resource, and therefore the managed Functions, run here.
// West Europe is the spec's stated fallback and unambiguously supported; try
// 'swedencentral' if you want the API in Sweden too — an unsupported region is
// rejected before anything is created, so it costs nothing to find out.
param staticWebAppLocation = 'westeurope'

/*
  ACCESS CONTROL — set at least one of these before anyone can sign in.

  The SWA Free tier cannot restrict the built-in Entra provider to one tenant,
  so any Microsoft account can authenticate. This allowlist is what actually
  keeps outsiders out (ADR-0017). Leaving both empty denies everyone, which is
  the intended fail-safe rather than a bug.
*/
param allowedEmailDomains = 'modig.se'
param allowedUserIds = ''
param adminUserIds = ''

// Replace with a real address; the budget alert is worthless otherwise.
param budgetAlertEmail = 'REPLACE_ME@modig.se'
param monthlyBudgetAmount = 5

// See ADR-0021: archiving breaks attachment viewing until the UI can handle it.
param enableArchiveTier = false
param coolAfterDays = 60
