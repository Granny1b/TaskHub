param staticWebAppName string

@secure()
param storageConnectionString string

param allowedEmailDomains string
param allowedUserIds string
param adminUserIds string

/*
  Application settings for the managed Functions.

  Separate from the Static Web App module to break a circular dependency: the
  storage account needs the app's hostname for its CORS rule, and the app needs
  the storage connection string. Splitting the settings out lets both resolve.

  These are the API's entire configuration. Nothing here is in the repository.
*/

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: staticWebAppName
}

resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    // The credential fallback the verification step forced on us (ADR-0010).
    AZURE_STORAGE_CONNECTION_STRING: storageConnectionString

    // On the Free tier this allowlist is the only thing between an outsider
    // with a Microsoft account and Modig's data. If both lists are empty the
    // API denies everyone — deliberately, so a misconfigured deploy is noticed
    // rather than silently public.
    TASKHUB_ALLOWED_DOMAINS: allowedEmailDomains
    TASKHUB_ALLOWED_USER_IDS: allowedUserIds
    TASKHUB_ADMIN_USER_IDS: adminUserIds
  }
}
