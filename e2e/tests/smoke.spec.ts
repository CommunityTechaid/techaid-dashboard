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
    await expect(page.locator('app-sidebar, .sidebar, #sidebar')).toBeVisible({ timeout: 10_000 });

    // No Angular errors in console (filter known benign messages)
    const angularErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('zone') &&
      !e.includes('404')
    );
    expect(angularErrors, `Unexpected console errors: ${angularErrors.join('\n')}`).toHaveLength(0);
  });

  test('user profile is available in header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-root')).toBeVisible();
    // Header should render (app-header or nav element)
    await expect(page.locator('app-header, nav.navbar')).toBeVisible({ timeout: 10_000 });
  });
});
