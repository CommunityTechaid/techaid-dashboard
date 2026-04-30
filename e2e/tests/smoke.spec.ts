import { test, expect } from '@playwright/test';

/**
 * Smoke tests: verify the app loads and the user is authenticated.
 * These run against the UAT backend (api-testing.communitytechaid.org.uk)
 * using the dev server started with `ng serve --configuration uat`.
 */
test.describe('Smoke', () => {
  test('app loads and shows dashboard', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page.locator('app-root')).toBeVisible();

    // Should not be on the login page
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Sidebar should be visible (indicates authenticated state)
    await expect(page.locator('app-sidebar').first()).toBeVisible({ timeout: 10_000 });

    // Filter out network-level errors and known SDK noise — we only want Angular
    // runtime crashes (e.g. template errors, DI failures).
    const angularErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('zone') &&
      !e.includes('404') &&
      !e.includes('CORS') &&
      !e.includes('Access-Control') &&
      !e.includes('ERR_FAILED') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::') &&
      // Auth0 SDK warning when no refresh token is present in the synthetic storageState
      !e.includes('Missing Refresh Token') &&
      // Downstream GraphQL "Access Denied" errors caused by the missing refresh token
      !e.includes('Access Denied')
    );
    expect(angularErrors, `Unexpected console errors: ${angularErrors.join('\n')}`).toHaveLength(0);
  });

  test('user profile is available in header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-root')).toBeVisible();
    // Header should render (app-header or nav element)
    await expect(page.locator('app-header').first()).toBeVisible({ timeout: 10_000 });
  });
});
