import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';

/**
 * Vitest global setup: start Azurite, create the containers, tear it all down.
 *
 * Phase 2's acceptance criterion is that conditional writes are proven against
 * real blob storage semantics, not a fake. The in-memory repository models the
 * same contract, but only Azurite can show that our `If-Match` actually reaches
 * Azure as a conditional header and that its 412 is what we turn into a 409.
 *
 * Runs on a non-default port so it never collides with an Azurite the developer
 * already has running for manual testing.
 */

const BLOB_PORT = 11_337;
const HOST = '127.0.0.1';

/** Well-known Azurite development credentials. Not a secret — published by Microsoft. */
export const AZURITE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;' +
  'AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  `BlobEndpoint=http://${HOST}:${BLOB_PORT}/devstoreaccount1;`;

let azurite: ChildProcess | null = null;
let workspace: string | null = null;

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ port, host: HOST });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Azurite did not start on port ${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };

    attempt();
  });
}

export async function setup(): Promise<void> {
  workspace = mkdtempSync(join(tmpdir(), 'taskhub-azurite-'));

  azurite = spawn(
    process.execPath,
    [
      join('node_modules', 'azurite', 'dist', 'src', 'blob', 'main.js'),
      '--silent',
      '--blobPort',
      String(BLOB_PORT),
      '--blobHost',
      HOST,
      '--location',
      workspace,
      // The storage SDK advertises a newer x-ms-version than this Azurite build
      // knows, and Azurite rejects the request outright rather than negotiating.
      // This is Microsoft's documented flag for exactly that mismatch. It only
      // relaxes the version *assertion*; the operations we use — conditional
      // upload, metadata, index tags, listing — are long-standing and behave
      // identically. Real Azure performs the real check.
      '--skipApiVersionCheck',
    ],
    { stdio: 'ignore', detached: false },
  );

  azurite.once('error', (error) => {
    throw new Error(`Failed to spawn Azurite: ${error.message}`);
  });

  await waitForPort(BLOB_PORT);

  process.env['AZURE_STORAGE_CONNECTION_STRING'] = AZURITE_CONNECTION_STRING;

  // Containers are created here rather than per-test so the tests exercise the
  // repository, not container bootstrapping.
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const client = BlobServiceClient.fromConnectionString(AZURITE_CONNECTION_STRING);
  await client.getContainerClient('tasks').createIfNotExists();
  await client.getContainerClient('attachments').createIfNotExists();
}

export async function teardown(): Promise<void> {
  if (azurite !== null) {
    azurite.kill('SIGTERM');
    azurite = null;
  }
  if (workspace !== null) {
    rmSync(workspace, { recursive: true, force: true });
    workspace = null;
  }
}
