@description('Storage account name. Globally unique, 3-24 lower-case alphanumeric characters.')
param name string

param location string
param environmentName string

@description('Origins permitted to upload attachments directly from the browser.')
param allowedOrigins array

param enableArchiveTier bool
param coolAfterDays int

/*
  Storage: the entire persistence layer for v1.

  StorageV2 / LRS / Hot, as the spec requires. LRS rather than ZRS because the
  cost target rules out the redundancy premium, and blob soft-delete plus the
  ability to re-enter data from the source workbook is proportionate insurance
  for an internal task tracker.
*/

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  tags: {
    application: 'TaskHub'
    environment: environmentName
  }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    // Containers are private and stay private. Attachments are reached only
    // through short-lived read SAS URLs.
    allowBlobPublicAccess: false
    // Required, not incidental: SWA-managed Functions cannot use managed
    // identity to reach storage (docs/VERIFICATION.md §3), so the API
    // authenticates with a connection string, and SAS signing needs the shared
    // key. Turning this off breaks both. See ADR-0010.
    allowSharedKeyAccess: true
    defaultToOAuthAuthentication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      // Private endpoints are a Standard-tier concern and out of scope for the
      // cost target. Access control is the SAS/key layer.
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      keySource: 'Microsoft.Storage'
      requireInfrastructureEncryption: false
      services: {
        blob: {
          enabled: true
          keyType: 'Account'
        }
      }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    // Cheap insurance: a deleted blob is recoverable for a week. v1 never
    // hard-deletes on a user action anyway, so this covers operator error and
    // the Phase-2 cleanup job.
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    cors: {
      corsRules: [
        {
          allowedOrigins: allowedOrigins
          // PUT for the direct upload; GET/HEAD for reading via SAS.
          allowedMethods: ['GET', 'HEAD', 'PUT', 'OPTIONS']
          // x-ms-blob-type is mandatory on a block blob PUT; without it in the
          // allowed list the browser preflight fails and uploads never start.
          allowedHeaders: ['x-ms-blob-type', 'x-ms-blob-content-type', 'content-type', 'content-length']
          exposedHeaders: ['etag', 'x-ms-request-id']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource tasksContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'tasks'
  properties: {
    publicAccess: 'None'
  }
}

resource attachmentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'attachments'
  properties: {
    publicAccess: 'None'
  }
}

/*
  Lifecycle policy.

  Only attachments are tiered. Task documents stay Hot: they are tiny, read on
  every page load, and cooling them would add per-read cost for no saving.
*/
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: concat(
        [
          {
            name: 'attachments-to-cool'
            enabled: true
            type: 'Lifecycle'
            definition: {
              filters: {
                blobTypes: ['blockBlob']
                prefixMatch: ['attachments/']
              }
              actions: {
                baseBlob: {
                  tierToCool: {
                    daysAfterModificationGreaterThan: coolAfterDays
                  }
                }
              }
            }
          }
        ],
        enableArchiveTier
          ? [
              {
                name: 'attachments-to-archive'
                enabled: true
                type: 'Lifecycle'
                definition: {
                  filters: {
                    blobTypes: ['blockBlob']
                    prefixMatch: ['attachments/']
                  }
                  actions: {
                    baseBlob: {
                      tierToArchive: {
                        daysAfterModificationGreaterThan: 365
                      }
                    }
                  }
                }
              }
            ]
          : []
      )
    }
  }
  dependsOn: [
    tasksContainer
    attachmentsContainer
  ]
}

output name string = storageAccount.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob

@secure()
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
