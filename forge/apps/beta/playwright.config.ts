import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the beta app.
 *
 * The dev server here is pointed at a local stand-in for GoTrue and PostgREST
 * (`e2e/support/mock-supabase.mjs`) rather than a real Supabase project,
 * because CI has no project and this sandbox cannot reach one. That stand-in
 * exists **only** under `e2e/`: it is started by this config, it is never
 * imported by application code, and nothing in a production build can reach it.
 * Fake auth must not be one environment variable away from a deployment.
 *
 * What that means for what these tests prove: the real middleware, the real
 * server actions, the real query layer and the real React tree all run. Supabase
 * itself, RLS enforcement through PostgREST, real token signing and email
 * delivery do not — those are covered by private.rls_selftest(),
 * private.authz_selftest() and, where nothing can cover them here, recorded as
 * NOT VERIFIED.
 */
const PORT = Number(process.env.E2E_PORT ?? 3101);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 54321);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Some environments ship a Chromium already and forbid downloading another —
 * the build sandbox does exactly that, and its build will not match whichever
 * one this Playwright version expects. Setting `PLAYWRIGHT_CHROMIUM_PATH` there
 * reuses it. Left unset, which is the normal case including CI, Playwright uses
 * the browser `playwright install` gave it.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  // Server actions mutate shared fixture state in the stand-in, so the specs
  // run in file order rather than racing each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions },
    },
  ],

  webServer: [
    {
      command: 'node e2e/support/mock-supabase.mjs',
      port: MOCK_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `next dev -p ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_stand_in',
        NEXT_PUBLIC_SITE_URL: BASE_URL,
        FORGE_DISABLED_FEATURES: '',
        // Deliberately pointed at the stand-in, which serves no tile style, so
        // the map failure path is what the suite exercises. Live tiles need a
        // provider key and are NOT VERIFIED here.
        NEXT_PUBLIC_MAP_STYLE_URL: `http://127.0.0.1:${MOCK_PORT}/style.json`,
      },
    },
  ],
});
