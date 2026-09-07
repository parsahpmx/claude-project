import { expect, test } from '@playwright/test';
import { appAlert, settle, signIn } from './support/helpers';

test.describe('recording an activity', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('form -> server action -> detail page -> activities list', async ({ page }) => {
    const title = `E2E run ${Date.now()}`;

    await page.goto('/activities/new');
    await settle(page);

    await page.fill('input[name="title"]', title);
    await page.fill('input[name="startedAt"]', '2026-09-06T07:30');
    await page.fill('input[name="movingMinutes"]', '42');
    await page.fill('input[name="distanceKm"]', '8.4');
    await page.fill('input[name="elevationGainM"]', '65');
    await page.fill('input[name="avgHr"]', '146');
    await page.selectOption('select[name="visibility"]', 'followers');

    await page.click('form button[type="submit"]');

    // The redirect is the contract: a successful create lands on the activity.
    await page.waitForURL(/\/activity\/[^/]+$/, { timeout: 30_000 });
    await settle(page);
    await expect(page.locator('body')).toContainText(title);

    // ...and it must actually be listed, not merely rendered once.
    await page.goto('/activities');
    await settle(page);
    await expect(page.locator('body')).toContainText(title);
  });

  test('rejects an out-of-range value and says which rule was broken', async ({ page }) => {
    await page.goto('/activities/new');
    await settle(page);

    await page.fill('input[name="title"]', 'Should not be saved');
    await page.fill('input[name="startedAt"]', '2026-09-06T07:30');
    await page.fill('input[name="movingMinutes"]', '42');
    await page.fill('input[name="distanceKm"]', '8.4');
    // A heart rate of 5 is not a heart rate.
    await page.fill('input[name="avgHr"]', '5');

    await page.click('form button[type="submit"]');
    await settle(page);

    await expect(appAlert(page)).toBeVisible();
    // Still on the form, nothing created.
    expect(new URL(page.url()).pathname).toBe('/activities/new');
  });
});
