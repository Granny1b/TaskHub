import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  type ContainerClient,
} from '@azure/storage-blob';
import { DomainError } from '@taskhub/shared';
import type {
  BlobFacts,
  IAttachmentStorage,
  ReadGrant,
  StoredBlob,
  UploadGrant,
} from './IAttachmentStorage.js';

/** Write grants are deliberately short: long enough to start, not to hoard. */
export const UPLOAD_SAS_MINUTES = 5;
/** Read grants are cached in memory by the client and re-fetched on expiry. */
export const READ_SAS_MINUTES = 15;

/**
 * Clock skew allowance. Without it, a client whose clock runs a minute fast
 * gets `AuthenticationFailed` on a SAS that has not started yet — a confusing
 * failure that looks like a permissions bug.
 */
const CLOCK_SKEW_MINUTES = 5;

export class BlobAttachmentStorage implements IAttachmentStorage {
  constructor(
    private readonly container: ContainerClient,
    private readonly credential: StorageSharedKeyCredential,
  ) {}

  /**
   * Bind the grant to HTTPS wherever the endpoint supports it.
   *
   * Against a real storage account this is always `HttpsOnly`, which is the
   * point: a SAS is a bearer credential in a URL, and one usable over plain
   * HTTP is one that can be read off the wire.
   *
   * The exception is the local emulator, which serves plain HTTP — demanding
   * HTTPS there produces `AuthorizationProtocolMismatch` on every upload. So
   * the constraint is derived from the endpoint rather than hardcoded: it can
   * only relax when the endpoint is already insecure, never for a deployed one.
   */
  private get protocol(): SASProtocol {
    return this.container.url.startsWith('https:') ? SASProtocol.Https : SASProtocol.HttpsAndHttp;
  }

  async createUploadGrant(input: { blobPath: string; contentType: string }): Promise<UploadGrant> {
    const now = new Date();
    const expiresOn = new Date(now.getTime() + UPLOAD_SAS_MINUTES * 60_000);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: input.blobPath,
        // Create + write only. No read, no delete, no list.
        permissions: BlobSASPermissions.parse('cw'),
        startsOn: new Date(now.getTime() - CLOCK_SKEW_MINUTES * 60_000),
        expiresOn,
        protocol: this.protocol,
        contentType: input.contentType,
      },
      this.credential,
    ).toString();

    const blobClient = this.container.getBlockBlobClient(input.blobPath);
    return {
      uploadUrl: `${blobClient.url}?${sas}`,
      blobPath: input.blobPath,
      expiresOn: expiresOn.toISOString(),
    };
  }

  async createReadGrant(blobPath: string): Promise<ReadGrant> {
    const now = new Date();
    const expiresOn = new Date(now.getTime() + READ_SAS_MINUTES * 60_000);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(now.getTime() - CLOCK_SKEW_MINUTES * 60_000),
        expiresOn,
        protocol: this.protocol,
      },
      this.credential,
    ).toString();

    const blobClient = this.container.getBlockBlobClient(blobPath);
    return { url: `${blobClient.url}?${sas}`, expiresOn: expiresOn.toISOString() };
  }

  async createDownloadGrant(blobPath: string, fileName: string): Promise<ReadGrant> {
    const now = new Date();
    const expiresOn = new Date(now.getTime() + READ_SAS_MINUTES * 60_000);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(now.getTime() - CLOCK_SKEW_MINUTES * 60_000),
        expiresOn,
        protocol: this.protocol,
        /*
          The whole difference between viewing and downloading.

          The filename is quoted and stripped of quotes and control characters
          first: it goes into a response header, and an unescaped quote there
          truncates the header rather than producing a clever filename.
        */
        contentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, '')}"`,
      },
      this.credential,
    ).toString();

    const blobClient = this.container.getBlockBlobClient(blobPath);
    return { url: `${blobClient.url}?${sas}`, expiresOn: expiresOn.toISOString() };
  }

  async listAll(): Promise<StoredBlob[]> {
    const blobs: StoredBlob[] = [];
    for await (const blob of this.container.listBlobsFlat()) {
      blobs.push({
        blobPath: blob.name,
        sizeBytes: blob.properties.contentLength ?? 0,
        contentType: blob.properties.contentType ?? 'application/octet-stream',
        lastModified: (blob.properties.lastModified ?? new Date(0)).toISOString(),
      });
    }
    return blobs;
  }

  async statBlob(blobPath: string): Promise<BlobFacts> {
    const blob = this.container.getBlockBlobClient(blobPath);
    try {
      const properties = await blob.getProperties();
      return { exists: true, sizeBytes: properties.contentLength ?? 0 };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    for await (const blob of this.container.listBlobsFlat({ prefix })) {
      await this.container.getBlockBlobClient(blob.name).deleteIfExists();
      deleted += 1;
    }
    return deleted;
  }
}

/**
 * Build the shared-key credential SAS signing requires.
 *
 * SAS signing needs either an account key or a user delegation key. v1 runs on
 * a connection string (ADR-0010), so the account key is what we have. If the
 * app later moves to managed identity, this is where `getUserDelegationKey`
 * would replace it — the interface above does not change.
 */
export function credentialFromConnectionString(
  connectionString: string,
): StorageSharedKeyCredential {
  const parts = new Map<string, string>();
  for (const segment of connectionString.split(';')) {
    const index = segment.indexOf('=');
    if (index === -1) continue;
    parts.set(segment.slice(0, index).trim(), segment.slice(index + 1).trim());
  }

  // Azurite's shorthand. Expanding it here means local development needs no
  // special-casing anywhere else.
  if (connectionString.includes('UseDevelopmentStorage=true')) {
    return new StorageSharedKeyCredential(
      'devstoreaccount1',
      'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==',
    );
  }

  const accountName = parts.get('AccountName');
  const accountKey = parts.get('AccountKey');

  if (accountName === undefined || accountKey === undefined) {
    throw new DomainError(
      'invalid_operation',
      'Cannot sign attachment SAS: the storage connection string has no AccountName/AccountKey. ' +
        'SAS signing needs a shared key (see ADR-0010).',
    );
  }

  return new StorageSharedKeyCredential(accountName, accountKey);
}
