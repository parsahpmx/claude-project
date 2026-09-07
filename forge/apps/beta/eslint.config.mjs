import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/** Next's own rules cover the framework-specific mistakes: client/server
 *  boundaries, image and link usage, and hook dependency arrays. */
const config = [
  {
    // `.next*` rather than `.next`: the build directory is configurable via
    // NEXT_DIST_DIR so the browser suite can build into `.next-e2e` without
    // racing a concurrent `pnpm build`. Linting generated output produces
    // hundreds of errors about code nobody wrote.
    ignores: ['**/.next*/**', '**/node_modules/**', 'next-env.d.ts', 'playwright-report/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
];

export default config;
