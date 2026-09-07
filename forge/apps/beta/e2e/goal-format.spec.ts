import { expect, test } from '@playwright/test';
import { settle, signIn } from './support/helpers';

/**
 * Regression test for a specific shipped bug.
 *
 * The same weekly-distance goal rendered as "40000m" on /home and "40.0 km" on
 * /goals, because Home printed the raw target beside the free-text `unit`
 * column while Goals formatted by goal kind. Both now go through
 * formatGoalValue(); this test exists so they cannot drift apart again.
 */
test.describe('goal formatting', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('a distance goal reads as a distance on both pages', async ({ page }) => {
    await page.goto('/home');
    await settle(page);
    const home = await page.locator('section[aria-labelledby="goals-heading"]').innerText();

    await page.goto('/goals');
    await settle(page);
    const goals = await page.locator('main').innerText();

    for (const [name, text] of [
      ['home', home],
      ['goals', goals],
    ] as const) {
      // The storage unit must never reach the reader.
      expect(text, `${name} shows raw metres`).not.toMatch(/\b40000\s*m\b/);
      expect(text, `${name} shows a formatted distance`).toMatch(/40\.0\s*km/);
    }
  });

  test('a count goal carries no invented unit', async ({ page }) => {
    await page.goto('/home');
    await settle(page);
    const home = await page.locator('section[aria-labelledby="goals-heading"]').innerText();
    // `unit` for a sessions goal is empty text; printing the column verbatim
    // previously produced things like "4 count".
    expect(home).not.toMatch(/\bcount\b/i);
    expect(home).toMatch(/Sessions each week/i);
  });
});
