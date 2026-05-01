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

async function getFirstHref(page: import('@playwright/test').Page, listUrl: string): Promise<string | null> {
  await withAuthInterceptor(page);
  await page.goto(listUrl);
  const link = page.locator('table tbody tr td a[href*="/dashboard/"]');
  const appeared = await link.first().waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true).catch(() => false);
  if (!appeared) return null;
  return link.first().getAttribute('href');
}

// ─── BUG-01: Settings dropdown ────────────────────────────────────────────────
test.describe('BUG-01: Settings dropdown', () => {
  test('clicking the user avatar opens the dropdown without navigating away', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard');
    await expect(page.locator('app-header')).toBeVisible({ timeout: 10_000 });

    const avatar = page.locator('app-header #userDropdown');
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

// ─── BUG-15: Kit-info hardware row is horizontal ─────────────────────────────
test.describe('BUG-15: Device hardware details row is laid out horizontally', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('hardware detail fields sit side-by-side, not stacked in a column', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

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
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('formly-form')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_000);

    // The first field-group (hardware row) uses fieldGroupClassName that must NOT
    // have Bootstrap's .row class. Without .row each formly-field is a flex item
    // and the bounding boxes overlap horizontally (same Y, different X).
    // With .row, Bootstrap forces width:100% on children so they stack vertically
    // (consecutive Y values, same X).
    const fieldGroup = page.locator('formly-group').first();
    const fields = fieldGroup.locator('formly-field');
    const count = await fields.count();
    if (count < 2) {
      test.skip(true, 'Fewer than 2 fields in first group — skipping');
      return;
    }

    const box0 = await fields.nth(0).boundingBox();
    const box1 = await fields.nth(1).boundingBox();
    if (!box0 || !box1) return;

    // If stacked vertically, box1.y > box0.y + box0.height (they don't overlap).
    // If laid out horizontally, box1.y ≈ box0.y (they share the same row).
    const verticallyStacked = box1.y > box0.y + box0.height;
    expect(verticallyStacked).toBe(false);
  });
});

// ─── BUG-16: Kit status colour blocks are coloured ───────────────────────────
test.describe('BUG-16: Device status radio blocks have the correct coloured backgrounds', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('first .kit-status .form-check block has yellow background, not salmon or transparent', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

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
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const firstBlock = page.locator('.kit-status .form-check').first();
    const blockAppeared = await firstBlock.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true).catch(() => false);
    if (!blockAppeared) {
      test.skip(true, 'kit-status block not found — skipping');
      return;
    }

    const bg = await firstBlock.evaluate(el => getComputedStyle(el).backgroundColor);
    // Transparent means nth-child is still off — fix did not apply
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    // Salmon (#FBCBC0 = rgb(251,203,192)) means nth-child is wrong (off by one)
    expect(bg).not.toBe('rgb(251, 203, 192)');
    // Expected amber/yellow: styles.css .kit-status .form-check:nth-child(2) after fix
    expect(bg).toBe('rgb(255, 234, 179)');
  });

  test('last .kit-status .form-check block (PROCESSING_STORED) has purple background', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

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
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const blocks = page.locator('.kit-status .form-check');
    const blockCount = await blocks.count();
    if (blockCount < 11) {
      test.skip(true, 'Fewer than 11 kit-status blocks found — skipping');
      return;
    }

    const lastBlock = blocks.last();
    await lastBlock.waitFor({ state: 'visible', timeout: 10_000 });
    const bg = await lastBlock.evaluate(el => getComputedStyle(el).backgroundColor);
    // Transparent means the last item has no nth-child rule — fix did not apply
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    // Expected purple: styles.css .kit-status .form-check:nth-child(12)
    expect(bg).toBe('rgb(221, 180, 231)');
  });
});

// ─── BUG-17: Device (kit) audit table loads data ─────────────────────────────
test.describe('BUG-17: Device audit table shows rows rather than "No data!"', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('device audit table is populated, not blank', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

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
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const auditTab = page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' });
    if (!(await auditTab.isVisible())) {
      test.skip(true, 'Audit Table tab not found (no admin:kits authority) — skipping');
      return;
    }
    await auditTab.click();

    await expect(page.locator('kit-audit-component table')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3_000);

    // Every device that has ever been saved has at least one audit revision.
    // The pre-fix code fired the query without the id, so entities was always [].
    await expect(page.locator('kit-audit-component td.no-data-available')).not.toBeVisible();
  });
});

// ─── BUG-18: DnD week filter buttons show historical data ────────────────────
test.describe('BUG-18: DnD week filter shows entries for past weeks', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('clicking a week filter button does not produce a persistently empty table', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);

    // Week buttons should be present
    const weekBtns = page.locator('button.btn-outline-primary, button.btn-primary');
    if (!(await weekBtns.first().isVisible())) {
      test.skip(true, 'No week filter buttons visible — skipping');
      return;
    }

    // Click the first week button (oldest week — most likely to have historical data)
    await weekBtns.first().click();
    await page.waitForTimeout(2_000);

    // Table must still be present (not broken by the filter)
    await expect(page.locator('table.dataTable')).toBeVisible();

    // The dt-empty / dataTables_empty cell must NOT be visible — pre-fix, week buttons
    // only generated future-week windows so every click returned 0 results and showed
    // the DataTables empty state.
    const emptyCell = page.locator('td.dt-empty, td.dataTables_empty');
    if (await emptyCell.count() > 0) {
      await expect(emptyCell.first()).not.toBeVisible();
    }
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

// ─── BUG-05: User dropdown right-aligned in topbar ────────────────────────────
test.describe('BUG-05: User dropdown is right-aligned in topbar', () => {
  test('navbar-nav sits in the right half of the topbar', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard');
    await expect(page.locator('app-header nav.navbar')).toBeVisible({ timeout: 10_000 });

    const navbarBox = await page.locator('nav.navbar').boundingBox();
    const navBox = await page.locator('nav.navbar ul.navbar-nav').boundingBox();
    if (!navbarBox || !navBox) return;

    // With ms-auto, the nav should be centred in the right half of the topbar
    const navCenter = navBox.x + navBox.width / 2;
    const navbarCenter = navbarBox.x + navbarBox.width / 2;
    expect(navCenter).toBeGreaterThan(navbarCenter);
  });
});

// ─── BUG-06: Inactive tab links not Bootstrap default blue ────────────────────
test.describe('BUG-06: Inactive tab link colour is not Bootstrap default blue', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('second tab link is not rgb(13, 110, 253) when inactive', async ({ page }) => {
    const href = await getFirstHref(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT — skipping');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('ul.nav-tabs .nav-link');
    if (await tabs.count() < 2) {
      test.skip(true, 'Fewer than 2 tabs — skipping colour check');
      return;
    }

    // First tab is active on load; second is inactive — check its colour
    const color = await tabs.nth(1).evaluate(el => getComputedStyle(el).color);
    // Bootstrap 5 default --bs-nav-link-color before the fix bled through as bright blue
    expect(color).not.toBe('rgb(13, 110, 253)');
  });
});

// ─── BUG-08: Status colour blocks have backgrounds ────────────────────────────
test.describe('BUG-08: Device request status radio blocks have coloured backgrounds', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('first status block has the expected amber background colour', async ({ page }) => {
    const href = await getFirstHref(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT — skipping');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const firstBlock = page.locator('.device-request-status .form-check').first();
    const appeared = await firstBlock.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true).catch(() => false);
    if (!appeared) {
      test.skip(true, 'Status colour block not found — skipping');
      return;
    }

    const bg = await firstBlock.evaluate(el => getComputedStyle(el).backgroundColor);
    // Transparent means the .form-check selector fix (BUG-08) did not apply
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    // Expected amber: styles.css .device-request-status .form-check:nth-child(1) { background-color: #FFEAB3 }
    expect(bg).toBe('rgb(255, 234, 179)');
  });
});

// ─── BUG-09: Audit table loads data, not "no data!" ───────────────────────────
test.describe('BUG-09: Device request audit table loads correctly', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('audit table shows rows rather than the "No data!" empty state', async ({ page }) => {
    const href = await getFirstHref(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT — skipping');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const auditTab = page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' });
    if (!(await auditTab.isVisible())) {
      test.skip(true, 'Audit Table tab not found — skipping');
      return;
    }
    await auditTab.click();

    await expect(page.locator('device-request-audit-component table')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3_000);

    // Every device request that has ever been saved must have at least one audit revision.
    // The pre-fix code fired the query without the id variable, so entities was always empty.
    await expect(page.locator('device-request-audit-component td.no-data-available')).not.toBeVisible();
  });
});

// ─── BUG-11: .pac-container z-index above Bootstrap 5 modal ──────────────────
test.describe('BUG-11: Google Places autocomplete z-index is above Bootstrap 5 modal', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('.pac-container z-index exceeds the Bootstrap 5 modal z-index of 1055', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/referring-organisation-contacts');
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });

    await page.locator('a', { hasText: 'Create Referee' }).click();
    await expect(page.locator('.modal.show')).toBeVisible({ timeout: 5_000 });

    // Inject a .pac-container element (simulating what Google Places autocomplete adds)
    // and read back the z-index that the CSS rule assigns to it.
    const zIndex = await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'pac-container';
      document.body.appendChild(div);
      const z = parseInt(getComputedStyle(div).zIndex, 10);
      document.body.removeChild(div);
      return z;
    });

    // Bootstrap 5 modal z-index is 1055; .pac-container must sit above it
    expect(zIndex).toBeGreaterThan(1055);
  });
});

// ─── BUG-13: Show/hide device types toggle actually works ─────────────────────
test.describe('BUG-13: Show/hide device types toggle changes field visibility', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('clicking the toggle reveals previously hidden device-type fields', async ({ page }) => {
    const href = await getFirstHref(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT — skipping');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('formly-form')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);

    const toggleBtn = page.locator('#toggleDeviceTypesBtn');
    if (!(await toggleBtn.isVisible())) {
      test.skip(true, 'Toggle button hidden (all device types filled) — skipping');
      return;
    }

    // Count formly-field elements that are currently visible in the DOM
    const countVisible = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('formly-field')).filter(
        el => getComputedStyle(el).display !== 'none'
      ).length
    );

    const before = await countVisible();
    await toggleBtn.click();
    await page.waitForTimeout(500);
    const after = await countVisible();

    // Toggling to showAllDeviceTypes=true must reveal at least one previously hidden field
    expect(after).toBeGreaterThan(before);
  });
});

// ─── BUG-14: D&D week filter keeps table inside the card ─────────────────────
test.describe('BUG-14: Distributions & Deliveries week filter keeps table in card', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('clicking a week filter button keeps the table inside the card-body', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await expect(page.locator('table.dataTable')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);

    // Verify the table is inside .card > .card-body before any filter click
    const tableInCard = await page.evaluate(() => {
      const table = document.querySelector('table.dataTable');
      return !!table?.closest('.card-body')?.closest('.card');
    });
    expect(tableInCard).toBe(true);

    // Click the first week filter button
    const weekBtn = page.locator('button.btn-outline-primary, button.btn-primary').first();
    if (await weekBtn.isVisible()) {
      await weekBtn.click();
      await page.waitForTimeout(1_000);

      // Table must still be inside the card after the filter is applied
      const tableInCardAfter = await page.evaluate(() => {
        const table = document.querySelector('table.dataTable');
        return !!table?.closest('.card-body')?.closest('.card');
      });
      expect(tableInCardAfter).toBe(true);

      // The table itself must remain visible
      await expect(page.locator('table.dataTable')).toBeVisible();
    }
  });
});
