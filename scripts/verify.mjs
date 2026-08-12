/**
 * The one command that proves a phase is green: `npm run verify`.
 *
 * Chains the gates in the order that fails fastest and most informatively.
 * Written in Node rather than as an npm script because `&&` chaining is not
 * available in PowerShell 5.1, which is a supported dev shell here (spec §1).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
  The Node version is a gate, not a footnote.

  This exists because it has already gone wrong: the suite was run on Node 22
  while `.nvmrc` and CI pin 20, and two test files that load fine on 22 fail to
  load at all on 20. Locally everything was green; CI was red for four commits
  before anyone looked. A `verify` that passes on a runtime nobody deploys is
  worse than no verify, because it is trusted.

  20 is not arbitrary — it is what the Static Web Apps managed Functions run
  (`staticwebapp.config.json`: `apiRuntime: node:20`).
*/
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedMajor = Number.parseInt(readFileSync(join(root, '.nvmrc'), 'utf8').trim(), 10);
const actualMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (actualMajor !== expectedMajor && process.env.TASKHUB_ALLOW_NODE_MISMATCH !== 'true') {
  console.error(
    `\nNode ${process.versions.node} is running, but this project targets Node ${expectedMajor} ` +
      `(.nvmrc, and the SWA Functions runtime).\n\n` +
      `Green here would not mean green in CI. Switch with nvm:\n` +
      `  nvm use\n\n` +
      `To run anyway, knowing the result proves less than it looks:\n` +
      `  TASKHUB_ALLOW_NODE_MISMATCH=true npm run verify\n`,
  );
  process.exit(1);
}

const steps = [
  ['format:check', 'Prettier formatting'],
  ['lint', 'ESLint (includes architectural boundary rules)'],
  ['typecheck', 'TypeScript strict build'],
  ['test', 'Vitest unit tests'],
  ['test:integration', 'Integration tests against Azurite'],
];

const isWindows = process.platform === 'win32';
const failures = [];

for (const [script, label] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(isWindows ? 'npm.cmd' : 'npm', ['run', script], {
    stdio: 'inherit',
    shell: isWindows,
  });
  if (result.status !== 0) {
    failures.push(label);
  }
}

console.log('\n=== summary ===');
if (failures.length === 0) {
  console.log('All gates passed.');
  process.exit(0);
}

for (const failure of failures) {
  console.error(`FAILED: ${failure}`);
}
process.exit(1);
