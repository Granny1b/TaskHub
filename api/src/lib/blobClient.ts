import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Blob service client factory.
 *
 * Two credential paths, deliberately, because the §2 verification found that
 * **SWA-managed Functions cannot use managed identity to reach Blob Storage**.
 * Static Web Apps only uses managed identity to pull secrets from Key Vault;
 * Microsoft's own guidance is to move to a "bring your own Functions app" if
 * the API itself needs managed identity.
 *
 * So v1 runs on a connection string held in SWA application settings — the
 * fallback the spec anticipated (§2.3). The credential path is written anyway
 * and selected by configuration, so the day the API moves to a standalone
 * Functions app the change is an app setting, not a code change.
 *
 * Precedence: account URL + managed identity wins if configured, because that
 * is the better posture and should be preferred automatically once available.
 *
 * See docs/VERIFICATION.md and docs/DECISIONS.md ADR-0010.
 */

export const TASKS_CONTAINER = 'tasks';
export const ATTACHMENTS_CONTAINER = 'attachments';

let cachedClient: BlobServiceClient | null = null;

export interface StorageConfig {
  /** e.g. https://sttaskhubprod.blob.core.windows.net — enables managed identity. */
  readonly accountUrl?: string | undefined;
  readonly connectionString?: string | undefined;
}

export function readStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    accountUrl: env['AZURE_STORAGE_ACCOUNT_URL'],
    connectionString: env['AZURE_STORAGE_CONNECTION_STRING'],
  };
}

export function createBlobServiceClient(config: StorageConfig): BlobServiceClient {
  if (config.accountUrl !== undefined && config.accountUrl.length > 0) {
    return new BlobServiceClient(config.accountUrl, new DefaultAzureCredential());
  }

  if (config.connectionString !== undefined && config.connectionString.length > 0) {
    return BlobServiceClient.fromConnectionString(config.connectionString);
  }

  throw new Error(
    'No storage credentials configured. Set AZURE_STORAGE_CONNECTION_STRING (SWA-managed ' +
      'Functions) or AZURE_STORAGE_ACCOUNT_URL (standalone Functions app with managed ' +
      'identity). See .env.example.',
  );
}

/** Process-wide singleton — the SDK client is designed to be reused. */
export function getBlobServiceClient(): BlobServiceClient {
  if (cachedClient === null) {
    cachedClient = createBlobServiceClient(readStorageConfig());
  }
  return cachedClient;
}

/** Test seam. */
export function resetBlobServiceClient(): void {
  cachedClient = null;
}
