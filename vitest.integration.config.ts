import { defineConfig } from 'vitest/config';

/**
 * Integration tests against Azurite.
 *
 * Kept in a separate config from the unit suite for one reason: these tests
 * spawn a process and talk to it over a socket, so they are slower and can fail
 * for environmental reasons rather than code reasons. Mixing them into the unit
 * run would make a fast, deterministic suite intermittently slow and flaky.
 *
 * `npm run verify` runs both, so nothing is skipped by default.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    globalSetup: ['./scripts/azuriteSetup.ts'],
    // Azurite is a single shared instance; parallel files would race on the
    // same containers. The concurrency that matters is tested *inside* the
    // tests, deliberately.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 40_000,
  },
});
