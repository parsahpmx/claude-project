import type { Page } from '@playwright/test';

/** The account the stand-in accepts. Matches e2e/support/fixtures.mjs. */
export const TEST_EMAIL = 'beta@forge.test';
export const TEST_PASSWORD = 'Beta-Test-1234';

/**
 * Every route the app serves without a session.
 * Kept in step with PUBLIC_EXACT in src/lib/auth/route-access.ts.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/features',
  '/how-it-works',
  '/pricing',
  '/about',
  '/privacy',
  '/terms',
  '/login',
  '/signup',
  '/forgot-password',
] as const;

/** Every route that requires a session today. */
export const GUARDED_ROUTES = [
  '/home',
  '/feed',
  '/maps',
  '/training',
  '/community',
  '/you',
  '/activities',
  '/activities/new',
  '/goals',
  '/programs',
  '/progress',
  '/routes',
  '/routes/new',
  '/settings/privacy',
  '/onboarding',
] as const;

/**
 * Areas that do not exist yet. They must redirect rather than 404 to an
 * anonymous visitor — a 404 would mean the guard did not run, which is how a
 * page shipped into one of these areas would leak on its first day.
 */
export const FUTURE_PRIVILEGED_ROUTES = [
  '/coach',
  '/coach/clients',
  '/gym',
  '/gym/members',
  '/admin',
  '/admin/users',
] as const;

/**
 * Wait until the page has settled.
 *
 * Screenshotting or asserting mid-hydration produces false failures: Playwright
 * injects a caret-hiding style for screenshots, and React reports that injected
 * attribute as a server/client mismatch if hydration is still in flight.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** Sign in through the real form. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await settle(page);
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('form button[type="submit"]');
  await page.waitForURL(/\/(home|onboarding)/, { timeout: 30_000 });
  await settle(page);
}

/** True when the page scrolls sideways, which it never should. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/**
 * The application's own alert.
 *
 * Next renders `<div role="alert" id="__next-route-announcer__">` on every
 * page for route-change announcements, so `getByRole('alert')` matches two
 * elements and fails strict mode. Excluding the announcer targets the message
 * the person actually sees.
 */
export function appAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}
