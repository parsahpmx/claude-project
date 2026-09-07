import { expect, test } from '@playwright/test';
import {
  GUARDED_ROUTES,
  PUBLIC_ROUTES,
  hasHorizontalOverflow,
  settle,
  signIn,
} from './support/helpers';

/**
 * Layout assertions rather than screenshots. A screenshot tells you something
 * changed; these tell you what is wrong — and they fail on a phone-width
 * regression that a desktop-only eye would miss.
 */
test.describe('public pages hold their layout', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  }
});

test.describe('authenticated pages hold their layout', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const route of GUARDED_ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  }

  test('primary navigation is reachable at every viewport', async ({ page }) => {
    await page.goto('/home');
    await settle(page);

    /**
     * The app ships two navs — a top bar for desktop (`hidden md:block`) and a
     * bottom bar for phones (`md:hidden`) — so exactly one is visible at any
     * width and picking `.first()` finds the hidden one on mobile.
     *
     * Asserting on href rather than link text matters for the same reason: the
     * bottom bar shortens "Community" to "Social" to fit, and a test that
     * demanded the long label would be enforcing a desktop detail on a phone
     * rather than the actual requirement, which is that each destination is
     * reachable.
     */
    for (const href of ['/home', '/maps', '/training', '/community', '/you']) {
      const link = page.locator(`nav a[href="${href}"]:visible`);
      await expect(link, `no visible nav link to ${href}`).toHaveCount(1);
    }
  });

  test('the record action is not cut off or overlapped', async ({ page }) => {
    await page.goto('/home');
    await settle(page);
    const record = page.getByRole('link', { name: /record/i }).first();
    await expect(record).toBeVisible();

    const box = await record.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'record control has no box').not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      // Comfortably tappable rather than a 20px sliver.
      expect(box.height).toBeGreaterThanOrEqual(32);
    }
  });
});
