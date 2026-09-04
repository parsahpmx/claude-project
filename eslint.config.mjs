import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

/**
 * Meter402 lint configuration.
 *
 * Beyond the usual hygiene rules, this config encodes two non-negotiable
 * product rules as machine-checkable lint failures rather than prose in a
 * document nobody re-reads:
 *
 *   1. No floating-point arithmetic on money (brief section 23).
 *   2. No `any` escape hatches in payment-critical packages (brief 158).
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /*
   * Money-safety rules. These packages compute, compare, or persist monetary
   * amounts. Every amount in them is a BigInt of minor units; anything that
   * can silently produce an IEEE-754 double is banned outright.
   */
  {
    files: [
      'packages/shared/**/*.ts',
      'packages/pricing/**/*.ts',
      'packages/payments/**/*.ts',
      'packages/blockchain/**/*.ts',
      'packages/x402/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Floating-point parsing is banned in money code. Use Money.fromDecimalString().',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'round',
          message:
            'Math.round implies float money. Use BigInt arithmetic with an explicit rounding mode.',
        },
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Floating-point parsing is banned in money code. Use Money.fromDecimalString().',
        },
      ],
    },
  },

  /*
   * Example apps and the CLI talk to a person at a terminal.
   *
   * `console` is their output device, not a leftover debug statement, so the
   * rule that keeps stray logging out of the server would only teach people to
   * write `process.stdout.write` in a tutorial.
   */
  {
    files: ['apps/example-*/**/*.ts', 'packages/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  /* Test files may use `any` when constructing deliberately malformed input. */
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  prettierConfig,
);
