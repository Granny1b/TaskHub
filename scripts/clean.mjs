/**
 * Cross-platform `clean`.
 *
 * Deliberately a Node script rather than an npm script: `rm -rf` is not a thing
 * in PowerShell, and this project is developed on Windows natively (spec §1).
 * Every npm script in this repo must run unmodified in PowerShell 5.1.
 */
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'shared/dist',
  'api/dist',
  'web/dist',
  'web/dist-types',
  'coverage',
  'shared/tsconfig.tsbuildinfo',
  'api/tsconfig.tsbuildinfo',
  'web/tsconfig.tsbuildinfo',
  'tsconfig.tsbuildinfo',
];

let removed = 0;
for (const target of targets) {
  const absolute = join(root, target);
  if (existsSync(absolute)) {
    rmSync(absolute, { recursive: true, force: true });
    console.log(`removed ${target}`);
    removed += 1;
  }
}

console.log(removed === 0 ? 'nothing to clean' : `cleaned ${removed} target(s)`);
