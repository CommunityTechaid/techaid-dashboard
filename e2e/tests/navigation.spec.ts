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
    // Dashboard component should render something
    await expect(page.locator('dashboard-index, app-dashboard-index, .card, h1, h2, h3').first()).toBeVisible({ timeout: 15_000 });
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

  test('404 page renders for unknown routes', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('app-root')).toBeVisible();
    // Either the 404 component or a redirect to /404
    await expect(page.locator('body')).toContainText(/404|not found|page/i, { timeout: 10_000 });
  });
});
