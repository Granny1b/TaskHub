import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config for the whole workspace.
 *
 * The architectural boundaries in docs/ARCHITECTURE.md are enforced here as lint
 * errors rather than review conventions. A rule a machine checks is a rule that
 * survives five years of feature work; a rule in a document is a rule that rots.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-types/**',
      'api-deploy/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'web/public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  /* ------------------------------------------------------------------ *
   * Boundary 1 — the single most important rule in the codebase (§3).
   *
   * Business logic and HTTP handlers never touch the Azure SDK. They go
   * through ITaskRepository. When a database arrives, only the files under
   * api/src/repositories/ change.
   * ------------------------------------------------------------------ */
  {
    files: ['api/src/domain/**/*.ts', 'api/src/functions/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Storage SDKs only. `@azure/functions` is the hosting framework
              // and HTTP handlers must import it — it is not a storage
              // dependency and banning it would ban having an API at all.
              group: ['@azure/storage-*', '@azure/identity', '@azure/cosmos', '@azure/data-tables'],
              message:
                'Storage SDK imports are confined to api/src/repositories/ and api/src/lib/. ' +
                'Depend on ITaskRepository / IAttachmentStorage instead — this is the seam ' +
                'that lets a real database replace Blob Storage without touching domain or ' +
                'HTTP code. See ADR-0003.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------ *
   * Boundary 2 — /shared is imported by both the browser and the Functions
   * host, so it must stay platform-neutral. No Node built-ins.
   * ------------------------------------------------------------------ */
  {
    files: ['shared/src/**/*.ts'],
    ignores: ['shared/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@azure/*'],
              message: 'See ADR-0003: /shared must not depend on the Azure SDK.',
            },
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'os'],
              message:
                '/shared is bundled into the browser. Node built-ins break the web build — ' +
                'use a platform-neutral implementation or inject the capability.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------ *
   * Boundary 3 — dumb components own no feature knowledge (§14).
   * ------------------------------------------------------------------ */
  {
    files: ['web/src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*', '@/features/*'],
              message:
                'web/src/components/ holds reusable presentational components. Importing a ' +
                'feature inverts the dependency and makes the component undeletable. Pass ' +
                'what it needs in as props.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  /* Build scripts run in Node, not the browser. */
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },

  prettier,
);
