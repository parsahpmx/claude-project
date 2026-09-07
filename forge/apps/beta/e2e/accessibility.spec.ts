import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { GUARDED_ROUTES, PUBLIC_ROUTES, settle, signIn } from './support/helpers';

/**
 * Automated accessibility sweep.
 *
 * This closes the gap recorded in the Phase 0 audit: the authenticated pages
 * had only ever been checked for overflow and console errors, never for
 * contrast or semantics. V1 was documented as accessible and a machine check
 * then found 166 contrast failures, so the authenticated area gets the same
 * scrutiny as the public one.
 *
 * `wcag22aa` is included alongside 2.0 and 2.1 because that is the stated
 * target. Automation catches perhaps half of what matters — keyboard order,
 * focus visibility and screen-reader sense still need a person, and those
 * findings are recorded in the phase report rather than pretended away here.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations;
}

function describeViolations(violations: Awaited<ReturnType<typeof scan>>): string {
  return violations
    .map((v) => {
      const where = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ');
      return `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n    at ${where}`;
    })
    .join('\n');
}

test.describe('public pages', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const violations = (await scan(page)).filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(violations.length, `\n${describeViolations(violations)}`).toBe(0);
    });
  }
});

test.describe('authenticated pages', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const route of GUARDED_ROUTES) {
    test(`${route} has no serious accessibility violations`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const violations = (await scan(page)).filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(violations.length, `\n${describeViolations(violations)}`).toBe(0);
    });
  }
});

test.describe('contrast specifically', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  // Contrast is called out on its own because it is the failure this codebase
  // has actually shipped before, and because it is one of the few things
  // automation judges reliably.
  for (const route of ['/home', '/goals', '/maps', '/activities', '/you', '/settings/privacy']) {
    test(`${route} meets contrast minimums`, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(results.violations.length, `\n${describeViolations(results.violations)}`).toBe(0);
    });
  }
});

test.describe('keyboard and semantics', () => {
  test('the sign-in form is operable by keyboard alone', async ({ page }) => {
    await page.goto('/login');
    await settle(page);

    // Tab until the email field has focus, then fill the form without a mouse.
    await page.keyboard.press('Tab');
    for (let i = 0; i < 12; i += 1) {
      const name = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.name);
      if (name === 'email') break;
      await page.keyboard.press('Tab');
    }
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.name)).toBe(
      'email',
    );

    // A focused control must be visibly focused, or keyboard users are lost.
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
    });
    expect(outline).not.toBeNull();
    const hasVisibleFocus =
      (outline?.outlineWidth && outline.outlineWidth !== '0px') ||
      (outline?.boxShadow && outline.boxShadow !== 'none');
    expect(hasVisibleFocus, 'focused input has no visible focus indicator').toBeTruthy();
  });

  test('every page has exactly one h1 and a main landmark', async ({ page }) => {
    await signIn(page);
    for (const route of ['/home', '/goals', '/activities', '/you']) {
      await page.goto(route);
      await settle(page);
      await expect(page.getByRole('main'), `${route} main landmark`).toHaveCount(1);
      const h1 = await page.locator('h1').count();
      expect(h1, `${route} should have exactly one h1, found ${h1}`).toBe(1);
    }
  });

  test('the map offers non-map content when tiles fail', async ({ page }) => {
    await signIn(page);
    await page.goto('/maps');
    await settle(page);
    // Tiles cannot load against the stand-in, which is the point: the page must
    // still convey routes and distances to someone who cannot see a map at all.
    await expect(page.getByText(/map unavailable/i)).toBeVisible();
    await expect(page.locator('main')).toContainText(/km/);
  });
});
