targetScope = 'subscription'

/*
  TaskHub infrastructure.

  Deploys the whole footprint: resource group, storage account with both
  containers, the Static Web App, and a budget alert. Idempotent — re-running it
  converges rather than duplicating.

  Ordering matters and is expressed through module dependencies:

    1. Static Web App     — so its hostname exists
    2. Storage            — needs that hostname for the CORS rule
    3. SWA app settings    — needs the storage connection string
    4. Budget

  Everything stays in the EU. See infra/README.md for how to run it.
*/

@description('Environment discriminator, used in resource names. Keep it short.')
@allowed(['dev', 'prod'])
param environmentName string = 'prod'

@description('Region for the storage account. All task data lives here.')
param location string = 'swedencentral'

@description('''
Region for the Static Web App resource — this is where the managed Functions
run; static assets are globally distributed regardless.

Defaults to West Europe, the spec's stated fallback, because it is
unambiguously a supported Static Web Apps region. Sweden Central may also work;
sources disagreed and it could not be confirmed (see docs/VERIFICATION.md).
Trying it costs nothing — an unsupported region is rejected at deployment time
before anything is created. Both options keep data in the EU.
''')
param staticWebAppLocation string = 'westeurope'

@description('Base name for resources. Lower-case letters and digits only.')
@minLength(3)
@maxLength(11)
param baseName string = 'taskhub'

@description('Email/UPN domains permitted to use the app, comma separated. On the SWA Free tier this allowlist is what keeps outsiders out — see ADR-0017.')
param allowedEmailDomains string = ''

@description('Entra object ids permitted to use the app, comma separated.')
param allowedUserIds string = ''

@description('Entra object ids granted the admin role, comma separated.')
param adminUserIds string = ''

@description('Address that receives the budget alert.')
param budgetAlertEmail string

@description('Monthly budget in EUR. The alert fires at 80% and 100%.')
param monthlyBudgetAmount int = 5

@description('''
Move attachments to the Archive tier after a year.

Defaults to FALSE despite the spec asking for it, because an archived blob
cannot be served by a read SAS: the request fails with BlobArchived and
rehydration takes hours. Turning this on would silently break attachment
viewing for anything older than a year. Enable it only once the UI has an
"archived — request restore" state. See docs/DECISIONS.md ADR-0021.
''')
param enableArchiveTier bool = false

@description('Days before attachments move to the Cool tier.')
param coolAfterDays int = 60

var resourceGroupName = 'rg-${baseName}-${environmentName}'
// Storage account names are globally unique, 3-24 chars, lower-case alphanumeric.
var storageAccountName = toLower('st${baseName}${environmentName}${substring(uniqueString(subscription().subscriptionId, baseName, environmentName), 0, 6)}')
var staticWebAppName = 'swa-${baseName}-${environmentName}'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'TaskHub'
    environment: environmentName
    managedBy: 'bicep'
  }
}

module staticWebApp 'modules/staticWebApp.bicep' = {
  name: 'staticWebApp'
  scope: resourceGroup
  params: {
    name: staticWebAppName
    location: staticWebAppLocation
    environmentName: environmentName
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: resourceGroup
  params: {
    name: storageAccountName
    location: location
    environmentName: environmentName
    // The browser uploads attachments directly to Blob Storage, so the storage
    // account must accept cross-origin PUTs from the app's own origin.
    allowedOrigins: [
      'https://${staticWebApp.outputs.defaultHostname}'
      'http://localhost:5173'
    ]
    enableArchiveTier: enableArchiveTier
    coolAfterDays: coolAfterDays
  }
}

module staticWebAppSettings 'modules/staticWebAppSettings.bicep' = {
  name: 'staticWebAppSettings'
  scope: resourceGroup
  params: {
    staticWebAppName: staticWebAppName
    storageConnectionString: storage.outputs.connectionString
    allowedEmailDomains: allowedEmailDomains
    allowedUserIds: allowedUserIds
    adminUserIds: adminUserIds
  }
}

module budget 'modules/budget.bicep' = {
  name: 'budget'
  scope: resourceGroup
  params: {
    name: 'budget-${baseName}-${environmentName}'
    amount: monthlyBudgetAmount
    contactEmail: budgetAlertEmail
  }
}

output resourceGroupName string = resourceGroup.name
output storageAccountName string = storage.outputs.name
output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
output appUrl string = 'https://${staticWebApp.outputs.defaultHostname}'
