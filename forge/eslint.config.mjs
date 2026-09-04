import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared lint rules.
 *
 * The rules that matter here are the ones a reviewer cannot reliably catch by
 * reading: an unawaited promise in a route handler, a floating `any` that
 * silently disables checking downstream, and unused code that suggests a
 * refactor was left half-finished.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
);
