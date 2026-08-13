/**
 * Local development server: the API over in-memory storage, plus the built web
 * bundle as static files.
 *
 * Why this exists: running the real thing locally needs the Azure Functions
 * Core Tools and Azurite. That is the right setup for working on the API, but
 * it is a heavy prerequisite for someone doing UI work, and it makes it awkward
 * to verify the frontend in CI or a container.
 *
 * What it deliberately does NOT do is reimplement any business logic. It routes
 * to the same `TaskService`, `ListService` and `InMemoryTaskRepository` the
 * tests use. Only the HTTP plumbing is separate from `api/src/functions/`, and
 * that plumbing is what the Azurite integration tests cover for the real path.
 *
 * Not for production. It has no authentication: every request is treated as a
 * fixed development user.
 *
 *   node scripts/devApi.mjs [--port 7071] [--static web/dist] [--seed]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve } from 'node:path';

const { TaskService } = await import('../api/dist/domain/taskService.js');
const { ListService } = await import('../api/dist/domain/listService.js');
const { AttachmentService } = await import('../api/dist/domain/attachmentService.js');
const { InMemoryTaskRepository, InMemoryTaskListRepository } =
  await import('../api/dist/repositories/InMemoryTaskRepository.js');
const shared = await import('@taskhub/shared');

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const PORT = Number(readArg('port', '7071'));
const STATIC_DIR = resolve(process.cwd(), readArg('static', 'web/dist'));
const SHOULD_SEED = args.includes('--seed');

const DEV_USER = 'dev-user';
const context = () => shared.createContext(DEV_USER);

/*
  Storage: in-memory by default, real blob storage when a connection string is
  present.

  Attachments need the second mode. A SAS is signed against a real account and
  the browser PUTs straight to it, so there is nothing in-memory storage can
  stand in for — point this at Azurite to exercise the upload pipeline for real.
*/
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const useBlobStorage = typeof connectionString === 'string' && connectionString.length > 0;

let taskRepository;
let listRepository;
let attachments = null;

if (useBlobStorage) {
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const { BlobTaskRepository } = await import('../api/dist/repositories/BlobTaskRepository.js');
  const { BlobTaskListRepository } =
    await import('../api/dist/repositories/BlobTaskListRepository.js');
  const { BlobAttachmentStorage, credentialFromConnectionString } =
    await import('../api/dist/repositories/BlobAttachmentStorage.js');

  const client = BlobServiceClient.fromConnectionString(connectionString);
  const tasksContainer = client.getContainerClient('tasks');
  const attachmentsContainer = client.getContainerClient('attachments');
  await tasksContainer.createIfNotExists();
  await attachmentsContainer.createIfNotExists();

  /*
    CORS, mirroring what infra/modules/storage.bicep configures in Azure.

    Uploads go browser -> blob directly, so without this every upload fails at
    the preflight with an opaque "Failed to fetch". The emulator starts with no
    CORS rules at all, which makes local testing silently unlike production —
    the one difference most likely to hide a real misconfiguration.

    `x-ms-blob-type` is the header that matters: it is mandatory on a block blob
    PUT, so omitting it from the allowed list breaks every upload.
  */
  await client.setProperties({
    cors: [
      {
        allowedOrigins: '*',
        allowedMethods: 'GET,HEAD,PUT,OPTIONS',
        allowedHeaders: 'x-ms-blob-type,x-ms-blob-content-type,content-type,content-length',
        exposedHeaders: 'etag,x-ms-request-id',
        maxAgeInSeconds: 3600,
      },
    ],
  });

  taskRepository = new BlobTaskRepository(tasksContainer);
  listRepository = new BlobTaskListRepository(tasksContainer);
  attachments = new BlobAttachmentStorage(
    attachmentsContainer,
    credentialFromConnectionString(connectionString),
  );
} else {
  taskRepository = new InMemoryTaskRepository();
  listRepository = new InMemoryTaskListRepository();
}

const tasks = new TaskService(taskRepository);
const lists = new ListService(listRepository);
const attachmentService =
  attachments === null ? null : new AttachmentService(taskRepository, attachments);

/* -------------------------------------------------------------------------- */
/* Seed data                                                                   */
/* -------------------------------------------------------------------------- */

async function seed() {
  // Idempotent: blob storage persists between restarts, and re-seeding would
  // otherwise stack duplicate lists and tasks on every launch.
  const existing = await tasks.list({});
  if (existing.length > 0) {
    console.log(`Storage already has ${existing.length} task(s); skipping seed.`);
    return;
  }

  const currentLists = await lists.list();
  const created = await lists.create(
    { name: 'Maskin 7' },
    currentLists.etag.length > 0 ? currentLists.etag : null,
    context(),
  );
  const second = await lists.create({ name: 'Kundprojekt Volvo' }, created.etag, context());

  const gearbox = await tasks.create(
    {
      title: 'Byt växellåda på maskin 7',
      comments: 'Se ritning 4b. Reservdelar beställda vecka 32.',
      listId: created.list.id,
    },
    context(),
  );

  let etag = gearbox.etag;
  for (const title of ['Demontera skydd', 'Lyft ur växellådan', 'Montera ny enhet', 'Provkör']) {
    const result = await tasks.addChild(gearbox.document.id, { title }, etag, context());
    etag = result.saved.etag;
  }

  // Two of four done, so the derived percent lands on a real number (50%).
  const current = await tasks.get(gearbox.document.id);
  const children = current.document.root.children;
  let workingEtag = current.etag;
  for (const child of children.slice(0, 2)) {
    const done = await tasks.patchChild(
      gearbox.document.id,
      child.id,
      { isComplete: true },
      workingEtag,
      context(),
    );
    workingEtag = done.etag;
  }

  const inspection = await tasks.create(
    {
      title: 'Kontrollera oljenivå spindel',
      comments: 'Månadskontroll',
      listId: created.list.id,
    },
    context(),
  );
  // Complete at a partial percent, to exercise the "✓ 40%" treatment.
  const withPercent = await tasks.patch(
    inspection.document.id,
    { node: { percent: 40 } },
    inspection.etag,
    context(),
  );
  await tasks.patch(
    inspection.document.id,
    { node: { isComplete: true } },
    withPercent.etag,
    context(),
  );

  await tasks.create(
    {
      title: 'Uppdatera kvalitetsdokumentation',
      comments: 'Efter ISO-revisionen i september',
      listId: second.list.id,
    },
    context(),
  );

  await tasks.create({ title: 'Ogrupperad uppgift utan lista', listId: null }, context());

  console.log('Seeded demo data.');
}

/* -------------------------------------------------------------------------- */
/* HTTP plumbing                                                               */
/* -------------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  response.end(body);
}

function sendJson(response, status, payload, etag) {
  send(response, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    ...(etag !== undefined && etag.length > 0 ? { ETag: etag } : {}),
  });
}

function sendProblem(response, error) {
  const statuses = {
    validation_failed: 400,
    invalid_operation: 400,
    depth_exceeded: 422,
    not_found: 404,
    concurrency_conflict: 409,
    precondition_required: 428,
    forbidden: 403,
    payload_too_large: 413,
  };
  const code = error?.code ?? 'internal_error';
  const status = statuses[code] ?? 500;
  if (status === 500) console.error(error);
  sendJson(response, status, { type: code, title: code, status, detail: error?.message });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const ifMatch = (request) => request.headers['if-match'] ?? '';

const noAttachments = () =>
  new shared.DomainError(
    'invalid_operation',
    'Attachments need real blob storage. Start Azurite and set ' +
      'AZURE_STORAGE_CONNECTION_STRING before running this server.',
  );

function requireIfMatch(request) {
  const value = ifMatch(request);
  if (value.length === 0 || value === '*') {
    throw new shared.DomainError('precondition_required', 'If-Match header required');
  }
  return value;
}

async function handleApi(request, response, url) {
  const segments = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const method = request.method ?? 'GET';

  if (segments[0] === 'me') {
    return sendJson(response, 200, {
      userId: DEV_USER,
      userDetails: 'dev@modig.se',
      identityProvider: 'dev',
      roles: ['member', 'admin'],
    });
  }

  /* Lists ---------------------------------------------------------------- */
  if (segments[0] === 'lists') {
    if (segments.length === 1 && method === 'GET') {
      const result = await lists.list();
      return sendJson(response, 200, { lists: result.lists }, result.etag);
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await readBody(request);
      const value = ifMatch(request);
      const result = await lists.create(body, value.length > 0 ? value : null, context());
      return sendJson(response, 201, { list: result.list }, result.etag);
    }
    if (segments[1] === 'reorder' && method === 'POST') {
      const body = await readBody(request);
      const result = await lists.reorder(
        body.movedId,
        body.toIndex,
        requireIfMatch(request),
        context(),
      );
      return sendJson(response, 200, { lists: result.lists }, result.etag);
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readBody(request);
      const result = await lists.patch(segments[1], body, requireIfMatch(request), context());
      const after = await lists.list();
      return sendJson(response, 200, { lists: after.lists }, result.etag);
    }
    if (segments.length === 2 && method === 'DELETE') {
      const result = await lists.softDelete(segments[1], requireIfMatch(request), context());
      const after = await lists.list();
      return sendJson(response, 200, { lists: after.lists }, result.etag);
    }
  }

  /* Tasks ---------------------------------------------------------------- */
  if (segments[0] === 'tasks') {
    if (segments.length === 1 && method === 'GET') {
      const listId = url.searchParams.get('listId');
      const isComplete = url.searchParams.get('isComplete');
      const q = url.searchParams.get('q');
      const filter = {
        ...(listId !== null ? { listId: listId === 'none' ? null : listId } : {}),
        ...(isComplete !== null ? { isComplete: isComplete === 'true' } : {}),
        ...(q !== null ? { q } : {}),
      };
      return sendJson(response, 200, { tasks: await tasks.list(filter) });
    }

    if (segments.length === 1 && method === 'POST') {
      const body = await readBody(request);
      const result = await tasks.create(body, context());
      return sendJson(response, 201, result.document, result.etag);
    }

    // Before `tasks/{id}`: this is a literal segment, not a task id.
    if (segments.length === 2 && segments[1] === 'reorder' && method === 'POST') {
      const body = await readBody(request);
      const result = await tasks.reorderTasks(body, requireIfMatch(request), context());
      response.setHeader('X-TaskHub-Renumbered', String(result.renumbered));
      return sendJson(response, 200, result.saved.document, result.saved.etag);
    }

    const id = segments[1];

    if (segments.length === 2 && method === 'GET') {
      const result = await tasks.get(id);
      return sendJson(response, 200, result.document, result.etag);
    }
    if (segments.length === 2 && method === 'PATCH') {
      const body = await readBody(request);
      const result = await tasks.patch(id, body, requireIfMatch(request), context());
      return sendJson(response, 200, result.document, result.etag);
    }
    if (segments.length === 2 && method === 'DELETE') {
      const result = await tasks.softDelete(id, requireIfMatch(request), context());
      return sendJson(
        response,
        200,
        shared.toTaskSummary(result.document, result.etag),
        result.etag,
      );
    }
    if (segments[2] === 'children' && segments.length === 3 && method === 'POST') {
      const body = await readBody(request);
      const result = await tasks.addChild(id, body, requireIfMatch(request), context());
      return sendJson(
        response,
        201,
        { child: result.child, task: result.saved.document },
        result.saved.etag,
      );
    }
    if (segments[2] === 'children' && segments.length === 4 && method === 'PATCH') {
      const body = await readBody(request);
      const result = await tasks.patchChild(
        id,
        segments[3],
        body,
        requireIfMatch(request),
        context(),
      );
      return sendJson(response, 200, result.document, result.etag);
    }
    if (segments[2] === 'children' && segments.length === 4 && method === 'DELETE') {
      const result = await tasks.removeChild(id, segments[3], requireIfMatch(request), context());
      return sendJson(response, 200, result.document, result.etag);
    }
    // Move a subtask to another main task. Returns the source, like the real
    // handler — the destination is refetched by the client (ADR-0042).
    if (
      segments[2] === 'children' &&
      segments[4] === 'move' &&
      segments.length === 5 &&
      method === 'POST'
    ) {
      const body = await readBody(request);
      const result = await tasks.moveChildToTask(
        id,
        segments[3],
        body.toTaskId,
        requireIfMatch(request),
        context(),
      );
      return sendJson(response, 200, result.from.document, result.from.etag);
    }
    if (segments[2] === 'attachments' && segments[3] === 'sas' && method === 'POST') {
      if (attachmentService === null) throw noAttachments();
      const body = await readBody(request);
      return sendJson(response, 200, await attachmentService.createUploadGrant(id, body));
    }
    if (segments[2] === 'attachments' && segments[3] === 'commit' && method === 'POST') {
      if (attachmentService === null) throw noAttachments();
      const body = await readBody(request);
      const result = await attachmentService.commit(id, body, requireIfMatch(request), context());
      return sendJson(
        response,
        201,
        { attachment: result.attachment, task: result.saved.document },
        result.saved.etag,
      );
    }
    if (segments[2] === 'attachments' && segments.length === 4 && method === 'DELETE') {
      if (attachmentService === null) throw noAttachments();
      const result = await attachmentService.remove(
        id,
        segments[3],
        requireIfMatch(request),
        context(),
      );
      return sendJson(response, 200, result.document, result.etag);
    }
    if (segments[2] === 'reorder' && method === 'POST') {
      const body = await readBody(request);
      const result = await tasks.reorder(id, body, requireIfMatch(request), context());
      return sendJson(response, 200, result.document, result.etag);
    }
  }

  /* Attachment read URLs ------------------------------------------------- */
  if (segments[0] === 'attachments' && segments[3] === 'url' && method === 'GET') {
    if (attachmentService === null) throw noAttachments();
    const grant = await attachmentService.createReadGrant(segments[1], segments[2], {
      thumbnail: url.searchParams.get('thumbnail') === 'true',
    });
    return sendJson(response, 200, grant);
  }

  return sendJson(response, 404, { type: 'not_found', title: 'No such route', status: 404 });
}

/** Text assets worth compressing. Images and fonts are already compressed. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

async function serveStatic(response, pathname, acceptEncoding = '') {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(STATIC_DIR, relative);

  if (!existsSync(filePath) || relative === '/' || relative === '\\') {
    // SPA fallback: any unknown path is a client route.
    filePath = join(STATIC_DIR, 'index.html');
  }

  if (!existsSync(filePath)) {
    return send(response, 404, 'Not found');
  }

  const body = await readFile(filePath);
  const extension = extname(filePath);

  /*
    Compress text assets.

    Static Web Apps serves gzip/brotli from its CDN, so an uncompressed local
    server measures a page nobody is actually served — Lighthouse scores against
    three times the real transfer size. Matching production here keeps the
    measurement honest in the direction that matters.
  */
  if (COMPRESSIBLE.has(extension) && acceptEncoding.includes('gzip')) {
    return send(response, 200, gzipSync(body), {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
    });
  }

  send(response, 200, body, {
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  const run = url.pathname.startsWith('/api')
    ? handleApi(request, response, url)
    : serveStatic(response, url.pathname, request.headers['accept-encoding'] ?? '');

  Promise.resolve(run).catch((error) => sendProblem(response, error));
});

if (SHOULD_SEED) await seed();

server.listen(PORT, () => {
  console.log(`Dev API on http://localhost:${PORT}`);
  console.log(`Serving ${STATIC_DIR}`);
  console.log(
    useBlobStorage
      ? 'Storage: blob (attachments enabled)'
      : 'Storage: in-memory (attachments disabled)',
  );
});
