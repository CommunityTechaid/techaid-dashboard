import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression tests for the post-upgrade bug batch.
 * Each test is written to FAIL before the fix and PASS after.
 *
 * Auth strategy: same GraphQL interception as tabs.spec.ts.
 */

function getBearerToken(): string {
  const statePath = resolve(process.cwd(), 'e2e/.auth/user.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) {
        const parsed = JSON.parse(item.value);
        return parsed?.body?.access_token ?? '';
      }
    }
  }
  throw new Error('No Auth0 token found in e2e/.auth/user.json');
}

async function withAuthInterceptor(page: import('@playwright/test').Page): Promise<void> {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    try {
      const { origin, 'sec-fetch-site': _a, 'sec-fetch-mode': _b, 'sec-fetch-dest': _c, ...safeHeaders } = route.request().headers();
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: { ...safeHeaders, 'Authorization': `Bearer ${token}`, 'host': 'api-testing.communitytechaid.org.uk' },
      });
      await route.fulfill({ response });
    } catch { /* context closed */ }
  });
}

// ─── BUG-01: Settings dropdown ────────────────────────────────────────────────
test.describe('BUG-01: Settings dropdown', () => {
  test('clicking the user avatar opens the dropdown without navigating away', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard');
    await expect(page.locator('app-header')).toBeVisible({ timeout: 10_000 });

    const avatar = page.locator('app-header .nav-item.dropdown .nav-link.dropdown-toggle').first();
    await expect(avatar).toBeVisible({ timeout: 5_000 });

    await avatar.click();

    // The dropdown menu should become visible
    const dropdownMenu = page.locator('app-header .dropdown-menu');
    await expect(dropdownMenu).toBeVisible({ timeout: 3_000 });

    // URL must NOT change (no navigation to home page)
    expect(page.url()).toContain('/dashboard');
  });
});

// ─── BUG-02: Device record pages ─────────────────────────────────────────────
test.describe('BUG-02: Device record pages load', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('navigating to a device page renders the tab structure', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

    // Wait for at least one device link in the table
    const linkLocator = page.locator('table tbody tr td a[routerlink*="/dashboard/devices/"]');
    const appeared = await linkLocator.first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true).catch(() => false);

    if (!appeared) {
      test.skip(true, 'No devices in UAT database — skipping');
      return;
    }

    const href = await linkLocator.first().getAttribute('href');
    await withAuthInterceptor(page);
    await page.goto(href);

    // The kit-info component should render — the nav-tabs element is the signal
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    // Ensure we are NOT showing an empty / blank page
    const tabCount = await page.locator('ul.nav-tabs .nav-link').count();
    expect(tabCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── BUG-03/04: DataTables empty state not visible above data ─────────────────
test.describe('BUG-03/04: DataTables empty-state hidden', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  async function assertNoVisibleEmptyRow(page: import('@playwright/test').Page, url: string) {
    await withAuthInterceptor(page);
    await page.goto(url);
    // Wait for the DataTable to initialise
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });
    // Wait a tick for AJAX + Angular rendering
    await page.waitForTimeout(2_000);

    // td.dt-empty (DataTables 2.x class) must not be visible
    const emptyCell = page.locator('td.dt-empty');
    if (await emptyCell.count() > 0) {
      await expect(emptyCell.first()).not.toBeVisible();
    }

    // Legacy class must also not be visible
    const legacyEmpty = page.locator('td.dataTables_empty');
    if (await legacyEmpty.count() > 0) {
      await expect(legacyEmpty.first()).not.toBeVisible();
    }
  }

  test('device-requests table has no visible empty-state row', async ({ page }) => {
    await assertNoVisibleEmptyRow(page, '/dashboard/device-requests');
  });

  test('referring-organisations table has no visible empty-state row', async ({ page }) => {
    await assertNoVisibleEmptyRow(page, '/dashboard/referring-organisations');
  });

  test('referring-organisation-contacts table has no visible empty-state row', async ({ page }) => {
    await assertNoVisibleEmptyRow(page, '/dashboard/referring-organisation-contacts');
  });

  test('distributions-and-deliveries table has no visible empty-state row', async ({ page }) => {
    await assertNoVisibleEmptyRow(page, '/dashboard/distributions-and-deliveries');
  });
});

// ─── BUG-07: Row selection does not apply opaque blue ────────────────────────
test.describe('BUG-07: Row click does not turn row opaque blue', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('clicking a device-request row does not cover text with solid blue', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/device-requests');
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);

    const firstRow = page.locator('table tbody tr').first();
    if (!(await firstRow.isVisible())) {
      test.skip(true, 'No rows — skipping');
      return;
    }

    await firstRow.click();

    // After clicking, the row cells must still have readable text colour
    // (not white-on-blue from DataTables selected). We check that the
    // computed box-shadow does NOT contain the opaque RGB(13,110,253) value
    // that DataTables 2.x injects for .selected rows.
    const firstCell = firstRow.locator('td').first();
    const boxShadow = await firstCell.evaluate(el => getComputedStyle(el).boxShadow);
    // The opaque DT selection is "inset 0 0 0 9999px rgb(13, 110, 253)"
    expect(boxShadow).not.toContain('9999px');
  });
});

// ─── BUG-10: Pagination right-aligned ────────────────────────────────────────
test.describe('BUG-10: DataTables pagination is right-aligned', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('pagination control sits in the right half of the table container', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);

    const paging = page.locator('div.dt-paging').first();
    if (!(await paging.isVisible())) return;

    const pagingBox = await paging.boundingBox();
    const containerBox = await page.locator('div.dt-container').first().boundingBox();
    if (!pagingBox || !containerBox) return;

    const pagingCenter = pagingBox.x + pagingBox.width / 2;
    const containerCenter = containerBox.x + containerBox.width / 2;
    // Pagination should start in or to the right of centre
    expect(pagingCenter).toBeGreaterThan(containerCenter);
  });
});

// ─── BUG-12: View Map button removed ─────────────────────────────────────────
test.describe('BUG-12: Defunct View Map button is gone', () => {
  test('devices page does not contain a "View Map" button', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator('app-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=View Map')).not.toBeVisible();
  });
});
