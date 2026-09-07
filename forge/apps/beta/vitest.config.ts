import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest's default include matches *.spec.ts, which would sweep up the
    // Playwright suite in e2e/ — those need a browser and a running server, and
    // fail immediately under Vitest with "did not expect test.describe()".
    // The two runners own separate directories: Vitest owns src/, Playwright
    // owns e2e/.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
