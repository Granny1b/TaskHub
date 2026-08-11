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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
const dependencies = { ...apiPackage.dependencies };
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

// Materialise the workspace package as a real dependency.
const sharedTarget = join(stageDir, 'node_modules', '@taskhub', 'shared');
mkdirSync(sharedTarget, { recursive: true });
cpSync(sharedDist, join(sharedTarget, 'dist'), { recursive: true });

const sharedPackage = JSON.parse(readFileSync(join(root, 'shared', 'package.json'), 'utf8'));
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

console.log('Installing production dependencies...');
const isWindows = process.platform === 'win32';
const install = spawnSync(
  isWindows ? 'npm.cmd' : 'npm',
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'],
  { cwd: stageDir, stdio: 'inherit', shell: isWindows },
);

if (install.status !== 0) fail('npm install failed in the staging folder.');

console.log(`API staged at ${stageDir}`);
