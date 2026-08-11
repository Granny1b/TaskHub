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
import { extname, join, normalize, resolve } from 'node:path';

const { TaskService } = await import('../api/dist/domain/taskService.js');
const { ListService } = await import('../api/dist/domain/listService.js');
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

const taskRepository = new InMemoryTaskRepository();
const listRepository = new InMemoryTaskListRepository();
const tasks = new TaskService(taskRepository);
const lists = new ListService(listRepository);

/* -------------------------------------------------------------------------- */
/* Seed data                                                                   */
/* -------------------------------------------------------------------------- */

async function seed() {
  const created = await lists.create({ name: 'Maskin 7' }, null, context());
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
    if (segments[2] === 'reorder' && method === 'POST') {
      const body = await readBody(request);
      const result = await tasks.reorder(id, body, requireIfMatch(request), context());
      return sendJson(response, 200, result.document, result.etag);
    }
  }

  return sendJson(response, 404, { type: 'not_found', title: 'No such route', status: 404 });
}

async function serveStatic(response, pathname) {
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
  send(response, 200, body, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  const run = url.pathname.startsWith('/api')
    ? handleApi(request, response, url)
    : serveStatic(response, url.pathname);

  Promise.resolve(run).catch((error) => sendProblem(response, error));
});

if (SHOULD_SEED) await seed();

server.listen(PORT, () => {
  console.log(`Dev API on http://localhost:${PORT}`);
  console.log(`Serving ${STATIC_DIR}`);
});
