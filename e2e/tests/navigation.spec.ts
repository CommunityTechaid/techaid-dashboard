import { test, expect } from '@playwright/test';

/**
 * Navigation tests: verify main sections load without errors.
 * Tests are intentionally lenient about data — the UAT backend may have
 * sparse data, so we only assert the page structure (tables, headings)
 * rather than specific row counts.
 */
test.describe('Navigation', () => {
  test('dashboard loads', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('app-root')).toBeVisible();
    await expect(page).not.toHaveURL(/auth0\.com/);
    // The app shell (sidebar + header) renders without GraphQL.
    // The dashboard data cards are inside *ngIf="model" and depend on a working API response.
    await expect(page.locator('app-sidebar').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('app-header').first()).toBeVisible();
  });

  test('devices list loads', async ({ page }) => {
    await page.goto('/dashboard/devices');
    await expect(page).not.toHaveURL(/auth0\.com/);
    // Wait for either a table or a "no results" message
    await expect(
      page.locator('table, .datatable, [class*="table"], .no-data, .empty').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('donors list loads', async ({ page }) => {
    await page.goto('/dashboard/donors');
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(
      page.locator('table, .datatable, [class*="table"], .no-data, .empty').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('device requests list loads', async ({ page }) => {
    await page.goto('/dashboard/device-requests');
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(
      page.locator('table, .datatable, [class*="table"], .no-data, .empty').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('referring organisations list loads', async ({ page }) => {
    await page.goto('/dashboard/referring-organisations');
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(
      page.locator('table, .datatable, [class*="table"], .no-data, .empty').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('users list loads', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(
      page.locator('table, .datatable, [class*="table"], .no-data, .empty').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('unknown routes stay within the app without crashing', async ({ page }) => {
    // The core-widgets catch-all `{ path: '**', component: PostDataComponent }` fires before
    // the app-level redirect to /404, so unknown paths render PostDataComponent rather than
    // App404. The important thing is that the app doesn't crash or redirect to Auth0.
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('app-root')).toBeVisible();
    await expect(page).not.toHaveURL(/auth0\.com/);
    // Sidebar and header should still be present (shell intact)
    await expect(page.locator('app-sidebar').first()).toBeVisible({ timeout: 10_000 });
  });
});
