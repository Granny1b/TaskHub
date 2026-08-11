param name string
param location string
param environmentName string

/*
  Static Web App, Free tier.

  Free gives the built-in Microsoft Entra ID provider, but it authenticates
  against the multi-tenant endpoint — any Microsoft account can sign in.
  Restricting to one tenant needs a custom OIDC provider, which is Standard
  only. The application enforces an allowlist instead (ADR-0017), configured
  through the app settings module.

  No Application Insights: it is the classic surprise line item on an otherwise
  near-free footprint. Functions log to the console; add it here when there is a
  reason to pay for it.
*/

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  tags: {
    application: 'TaskHub'
    environment: environmentName
  }
  properties: {
    // staticwebapp.config.json is deployed with the app and must be honoured.
    allowConfigFileUpdates: true
    // Free supports no staging environments; being explicit avoids a confusing
    // failure when someone opens a pull request.
    stagingEnvironmentPolicy: 'Disabled'
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output id string = staticWebApp.id
