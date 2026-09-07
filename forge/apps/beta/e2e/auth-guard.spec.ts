import { expect, test } from '@playwright/test';
import { FUTURE_PRIVILEGED_ROUTES, GUARDED_ROUTES, settle, signIn } from './support/helpers';

test.describe('signed out', () => {
  for (const route of GUARDED_ROUTES) {
    test(`${route} redirects to sign-in and remembers where you were going`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      // Without `next` the person is dumped on /home after signing in, which is
      // the symptom that revealed middleware was not running at all.
      expect(url.searchParams.get('next')).toBe(route);
    });
  }

  /**
   * These areas have no pages yet. The guard must still cover them, because the
   * failure mode it replaced was silent: a route absent from the old protected
   * list was simply served.
   */
  for (const route of FUTURE_PRIVILEGED_ROUTES) {
    test(`${route} is guarded before it is built`, async ({ page }) => {
      const response = await page.goto(route);
      await settle(page);
      expect(new URL(page.url()).pathname, `${route} should not be served`).toBe('/login');
      expect(response?.status()).toBe(200);
    });
  }
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const route of GUARDED_ROUTES) {
    test(`${route} renders for a signed-in athlete`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      // /onboarding forwards to /home once the profile is complete, which is
      // correct rather than a redirect back to sign-in.
      expect(new URL(page.url()).pathname).not.toBe('/login');
      await expect(page.locator('body')).not.toBeEmpty();
    });
  }

  test('the sign-in page is pointless once signed in', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    expect(new URL(page.url()).pathname).toBe('/home');
  });
});
