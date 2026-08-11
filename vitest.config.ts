import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['shared/src/**/*.test.ts', 'api/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['shared/src/**/*.ts', 'api/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        // Thin HTTP handlers are covered by Phase 2 integration tests against
        // Azurite, not by unit tests. Counting them here would report a
        // misleadingly low number for the domain layer.
        'api/src/functions/**',
      ],
      thresholds: {
        // Phase 1 acceptance criterion: the domain layer is the part that must
        // be provably correct, so it carries the gate. See docs/DECISIONS.md.
        'shared/src/domain/**/*.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
