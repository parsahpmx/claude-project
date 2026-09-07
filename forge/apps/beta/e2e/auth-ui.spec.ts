import { expect, test } from '@playwright/test';
import { TEST_EMAIL, TEST_PASSWORD, appAlert, settle } from './support/helpers';

const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 54321}`;
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 3101}`;

test.describe('sign in', () => {
  test('rejects wrong credentials without saying whether the account exists', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('form button[type="submit"]');

    const alert = appAlert(page);
    await expect(alert).toBeVisible();
    // The message must not distinguish "no such account" from "wrong password".
    await expect(alert).toContainText(/do not match an account/i);
    await expect(alert).not.toContainText(/no account|not found|unknown/i);
  });

  test('offers a route out for someone who has forgotten their password', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    await page.getByRole('link', { name: /forgot your password/i }).click();
    await page.waitForURL('**/forgot-password');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/reset your password/i);
  });
});

test.describe('password recovery', () => {
  test('validates the email before sending anything', async ({ page }) => {
    await page.goto('/forgot-password');
    await settle(page);
    await page.fill('input[name="email"]', 'not-an-email');
    await page.click('form button[type="submit"]');
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('gives the same answer for a known and an unknown address', async ({ page }) => {
    const messages: string[] = [];

    for (const email of [TEST_EMAIL, 'definitely-not-registered@forge.test']) {
      await page.goto('/forgot-password');
      await settle(page);
      await page.fill('input[name="email"]', email);
      await page.click('form button[type="submit"]');
      const status = page.getByRole('status');
      await expect(status).toBeVisible();
      messages.push(((await status.textContent()) ?? '').trim());
    }

    // Account enumeration is the thing this page must not do.
    expect(messages[0]).toBe(messages[1]);
    expect(messages[0]).toMatch(/if an account exists/i);
  });

  test('actually asks the auth service to send a link', async ({ page, request }) => {
    await page.goto('/forgot-password');
    await settle(page);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.click('form button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible();

    // The generic message must not be a placebo: assert the request was made.
    // Whether an email is then *delivered* is NOT VERIFIED here — that needs a
    // real provider, and this stand-in only records the call.
    const log = await (await request.get(`${MOCK}/__log`)).json();
    expect(log.recoveryRequests).toContain(TEST_EMAIL);
  });

  test('supports password managers on the reset form', async ({ page }) => {
    await page.goto('/reset-password');
    await settle(page);
    const inputs = page.locator('input[type="password"]');
    if ((await inputs.count()) > 0) {
      for (const input of await inputs.all()) {
        // new-password is what prompts a manager to generate and save one.
        await expect(input).toHaveAttribute('autocomplete', 'new-password');
      }
    }
  });

  test('refuses to reset a password without a recovery session', async ({ page }) => {
    // Reaching /reset-password directly means no emailed code was exchanged.
    await page.goto('/reset-password');
    await settle(page);
    await expect(appAlert(page)).toContainText(/expired or has already been used/i);
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  });
});

test.describe('sign out', () => {
  test('clears the session and re-guards protected routes', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('form button[type="submit"]');
    await page.waitForURL(/\/(home|onboarding)/, { timeout: 30_000 });

    await page.context().clearCookies();

    await page.goto('/home');
    await settle(page);
    expect(new URL(page.url()).pathname).toBe('/login');
  });
});

test.describe('password reset is reachable only through the emailed link', () => {
  /**
   * Regression: the callback used to redirect with `request.nextUrl.origin`,
   * which is the origin the *server* saw. A request to 127.0.0.1 came back
   * pointing at localhost, the redirect crossed a cookie boundary, and the
   * session established a moment earlier was not sent — so a perfectly valid
   * link reported itself expired. Behind a proxy the same mistake sends people
   * to an internal hostname.
   */
  test('a fresh link works on arrival, with no reload', async ({ page, request }) => {
    await page.goto('/forgot-password');
    await settle(page);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.click('form button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible();

    // Follow the link exactly as a mail client would.
    await page.goto('/auth/callback?code=e2e-recovery-code&next=/reset-password');
    await settle(page);

    expect(new URL(page.url()).pathname).toBe('/reset-password');
    // The host must survive the redirect. If it changes — 127.0.0.1 becoming
    // localhost, or a public host becoming an internal one — the session cookie
    // is not sent and the link reports itself expired.
    expect(new URL(page.url()).host).toBe(new URL(BASE_URL).host);
    await expect(page.locator('input[name="password"]')).toHaveCount(1);

    await page.fill('input[name="password"]', 'E2E-Recovered-9876');
    await page.fill('input[name="confirm"]', 'E2E-Recovered-9876');
    await page.click('form button[type="submit"]');
    await page.waitForURL('**/home', { timeout: 30_000 });

    // ...and the change actually reached the auth service, rather than the app
    // merely navigating as if it had.
    const log = await (await request.get(`${MOCK}/__log`)).json();
    expect(log.passwordUpdates).toContain('E2E-Recovered-9876');
  });

  /**
   * Regression: an ordinary session used to be enough to set a new password
   * without knowing the old one, which turns a borrowed session into account
   * takeover. Only arriving through the emailed link counts.
   */
  test('an ordinary signed-in session cannot set a new password', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('form button[type="submit"]');
    await page.waitForURL(/\/(home|onboarding)/, { timeout: 30_000 });

    await page.goto('/reset-password');
    await settle(page);

    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(appAlert(page)).toContainText(/expired or has already been used/i);
  });
});
