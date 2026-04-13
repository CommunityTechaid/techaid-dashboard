import { test, expect } from '@playwright/test';

/**
 * Tab switching tests — regression coverage for the ngb-tabset → ngb-nav migration.
 *
 * All 10 templates were migrated from the removed `ngb-tabset/ngb-tab` API to the
 * `ngb-nav/ngbNavItem` API. These tests verify that tabs render and switch correctly.
 *
 * Tests depend on the UAT backend having at least one record of each entity type.
 * If the UAT database is empty for a given entity, the test is skipped gracefully.
 */

async function getFirstIdFromList(page: import('@playwright/test').Page, listUrl: string): Promise<string | null> {
  await page.goto(listUrl);
  // Wait for table to settle
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  // Look for a link that goes to a detail page (typically an ID link in a DataTable row)
  const links = page.locator('table tbody tr td a[href*="/dashboard/"]');
  const count = await links.count();
  if (count === 0) return null;
  const href = await links.first().getAttribute('href');
  return href;
}

test.describe('Tab navigation (ngb-nav migration regression)', () => {
  test('kit-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/devices');
    if (!href) {
      test.skip(true, 'No devices in UAT database — skipping tab test');
      return;
    }

    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[ngbNavLink], .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount, 'Should have at least one tab').toBeGreaterThanOrEqual(1);

    // Click each tab and verify it becomes active
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('donor-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/donors');
    if (!href) {
      test.skip(true, 'No donors in UAT database — skipping tab test');
      return;
    }

    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[ngbNavLink], .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('device-request-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT database — skipping tab test');
      return;
    }

    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[ngbNavLink], .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('referring-organisation-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/referring-organisations');
    if (!href) {
      test.skip(true, 'No referring organisations in UAT database — skipping tab test');
      return;
    }

    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('[ngbNavLink], .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });
});
