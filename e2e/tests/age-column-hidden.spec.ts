import { test, expect } from '@playwright/test';

/**
 * Regression test: the "Age" column must NOT appear in the device table headers.
 * Covers kit-index (/dashboard/devices).
 */
test.describe('Age column removed from device tables', () => {
  test('devices list does not show Age column header', async ({ page }) => {
    await page.goto('/dashboard/devices');
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Wait for the table to be present in DOM (DataTables renders it)
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 20_000 });

    // Assert no <th> contains the exact text "Age"
    const ageHeaders = page.locator('table.dataTable thead th', { hasText: /^Age$/i });
    await expect(ageHeaders).toHaveCount(0);
  });
});
