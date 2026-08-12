/**
 * Assemble a self-contained deployment folder for the Functions API.
 *
 * The API depends on `@taskhub/shared`, a workspace package that does not
 * exist on npm. The Static Web Apps deployment uploads a folder and expects it
 * to resolve its own imports, so the workspace link has to become a real
 * directory inside `node_modules` before it leaves this machine.
 *
 * Doing this here, rather than letting the SWA build service work it out, keeps
 * the deployment deterministic: what we test is what we ship.
 *
 * Cross-platform Node rather than shell, per the project's OS constraint.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = join(root, 'api-deploy');

function fail(message) {
  console.error(`stageApi: ${message}`);
  process.exit(1);
}

const apiDist = join(root, 'api', 'dist');
const sharedDist = join(root, 'shared', 'dist');

if (!existsSync(apiDist)) fail('api/dist not found. Run `npm run build` first.');
if (!existsSync(sharedDist)) fail('shared/dist not found. Run `npm run build` first.');

console.log('Staging API deployment folder...');
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Compiled handlers.
cpSync(apiDist, join(stageDir, 'dist'), { recursive: true });

// Functions host configuration.
cpSync(join(root, 'api', 'host.json'), join(stageDir, 'host.json'));

/*
  A package.json without the workspace reference.

  `@taskhub/shared` is stripped from dependencies and materialised directly into
  node_modules below; leaving it here would make `npm install` try to fetch a
  package that does not exist on the registry.
*/
const apiPackage = JSON.parse(readFileSync(join(root, 'api', 'package.json'), 'utf8'));
const sharedPackage = JSON.parse(readFileSync(join(root, 'shared', 'package.json'), 'utf8'));

/*
  Shared's own runtime dependencies have to be installed here too.

  Nothing installs them otherwise: the package is copied in by hand, not resolved
  by npm, so its `dependencies` are metadata and no more. On a developer machine
  the gap is invisible — `ulid` and `zod` are hoisted to the workspace root and
  Node finds them on the way up. On the deployment target there is no way up.
*/
const dependencies = { ...sharedPackage.dependencies, ...apiPackage.dependencies };
delete dependencies['@taskhub/shared'];

writeFileSync(
  join(stageDir, 'package.json'),
  `${JSON.stringify(
    {
      name: apiPackage.name,
      version: apiPackage.version,
      private: true,
      type: 'module',
      main: 'dist/index.js',
      dependencies,
    },
    null,
    2,
  )}\n`,
);

/*
  Install FIRST, then materialise the workspace package.

  The order is the whole trick, and getting it wrong is silent. `npm install`
  prunes anything in node_modules that is not in the dependency tree, and
  `@taskhub/shared` is deliberately not in it — so materialising first means npm
  deletes it again, reporting only "removed 1 package". The staged folder then
  looks complete, and imports still resolve *on a developer machine* because
  Node walks up out of the folder and finds the workspace symlink at the repo
  root. In Azure there is no parent workspace: the entry module throws, the
  Functions host registers nothing at all, and every route answers 404 with no
  error anywhere to explain it.
*/
console.log('Installing production dependencies...');
const isWindows = process.platform === 'win32';
const install = spawnSync(
  isWindows ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'],
  { cwd: stageDir, stdio: 'inherit', shell: isWindows },
);

if (install.status !== 0) fail('npm install failed in the staging folder.');

console.log('Materialising @taskhub/shared...');
const sharedTarget = join(stageDir, 'node_modules', '@taskhub', 'shared');
mkdirSync(sharedTarget, { recursive: true });
cpSync(sharedDist, join(sharedTarget, 'dist'), { recursive: true });

writeFileSync(
  join(sharedTarget, 'package.json'),
  `${JSON.stringify(
    {
      name: sharedPackage.name,
      version: sharedPackage.version,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: sharedPackage.exports,
      dependencies: sharedPackage.dependencies,
    },
    null,
    2,
  )}\n`,
);

/*
  Prove the folder stands on its own.

  Deliberately a filesystem check rather than `require.resolve` or an import:
  both walk up the directory tree, find the workspace root, and cheerfully
  confirm a package that will not exist on the deployment target. That false
  positive is exactly what shipped an API with no functions in it.
*/
const staged = JSON.parse(readFileSync(join(stageDir, 'package.json'), 'utf8'));
const required = [...Object.keys(staged.dependencies ?? {}), '@taskhub/shared'];
const missing = required.filter(
  (name) => !existsSync(join(stageDir, 'node_modules', name, 'package.json')),
);

if (missing.length > 0) {
  fail(
    `these packages are not physically present in ${stageDir}/node_modules: ${missing.join(', ')}.\n` +
      'The folder would deploy and fail to load, registering no functions at all.',
  );
}

if (!existsSync(join(sharedTarget, 'dist', 'index.js'))) {
  fail('@taskhub/shared was staged without its compiled entry point.');
}

/*
  And then actually load it, somewhere the workspace cannot rescue it.

  The presence check above only catches what the staged package.json already
  declares. It would not have caught `ulid` — a dependency of @taskhub/shared
  that nothing installed, because a hand-copied package's dependencies are
  metadata, not instructions. Node found it anyway by walking up to the hoisted
  copy at the repo root.

  So the folder is copied to a temp directory with no workspace above it and the
  entry point is imported there. That is the only check that answers the
  question the deployment actually asks: does this folder work on its own?
  A few seconds and a copy, against an API that deploys clean and serves 404.
*/
console.log('Verifying the staged folder loads standalone...');
const probeDir = mkdtempSync(join(tmpdir(), 'taskhub-api-'));

try {
  cpSync(stageDir, probeDir, { recursive: true });

  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      "import('./dist/index.js').then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });",
    ],
    { cwd: probeDir, encoding: 'utf8' },
  );

  if (probe.status !== 0) {
    // The registration warnings are expected outside the Functions host; the
    // error on stderr is not.
    fail(
      `the staged folder does not load on its own:\n${(probe.stderr ?? '')
        .split('\n')
        .filter((line) => !line.includes('test mode') && line.trim().length > 0)
        .join('\n')}`,
    );
  }
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}

console.log(`API staged at ${stageDir} (${required.length} packages verified, loads standalone)`);
