/**
 * The one command that proves a phase is green: `npm run verify`.
 *
 * Chains the gates in the order that fails fastest and most informatively.
 * Written in Node rather than as an npm script because `&&` chaining is not
 * available in PowerShell 5.1, which is a supported dev shell here (spec §1).
 */
import { spawnSync } from 'node:child_process';

const steps = [
  ['format:check', 'Prettier formatting'],
  ['lint', 'ESLint (includes architectural boundary rules)'],
  ['typecheck', 'TypeScript strict build'],
  ['test', 'Vitest unit tests'],
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
