import { expect, test } from '@playwright/test';
import { PUBLIC_ROUTES, hasHorizontalOverflow, settle } from './support/helpers';

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} serves anonymously and renders`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} status`).toBe(200);
      await settle(page);

      // Landing on the sign-in page instead would mean the guard is wrong.
      expect(new URL(page.url()).pathname).toBe(route);
      // A 200 that renders nothing is not a working page.
      await expect(page.locator('body')).not.toBeEmpty();
      expect(await hasHorizontalOverflow(page), `${route} overflows sideways`).toBe(false);
    });
  }

  test('the landing page states what FORGE is and offers a way in', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /start free beta/i }).first()).toBeVisible();
  });
});
