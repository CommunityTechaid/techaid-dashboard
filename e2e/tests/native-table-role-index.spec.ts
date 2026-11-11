/**
 * Native table shell (#113, milestone 1) — parity cover on role-index, the pilot page.
 *
 * Pins the DataTables behaviour the native shell must keep for every page that migrates:
 * info line, page-length menu, paging, the asc/desc sort cycle (#336: a header click reverses,
 * never clears), search (400 ms as-you-type throttle, Enter immediately, page reset), the header
 * search box, stale-response dropping, and the DataTables-compatible class names the other specs
 * select on.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Captured { page: { sort: { key: string; value: string }[]; size: number; page: number }; term: string }

const ALL = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, name: `Role ${String(i + 1).padStart(2, '0')}`, description: `desc ${i + 1}`,
}));

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, opts: { delayFor?: Record<string, number>; fail?: boolean } = {}): Promise<Captured[]> {
  const seen: Captured[] = [];
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('findAllRoles')) {
      const v = JSON.parse(body).variables as Captured;
      seen.push(v);
      if (opts.fail) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'boom' }] }) });
      }
      const term = (v.term || '').toLowerCase();
      const rows = ALL.filter(r => r.name.toLowerCase().includes(term));
      const dir = v.page.sort[0]?.value === 'desc' ? -1 : 1;
      const sortKey = (v.page.sort[0]?.key ?? 'name') as 'name' | 'description';
      rows.sort((a, b) => dir * a[sortKey].localeCompare(b[sortKey]));
      const out = { roles: { totalElements: rows.length, number: v.page.page, content: rows.slice(v.page.page * v.page.size, (v.page.page + 1) * v.page.size) } };
      const delay = opts.delayFor?.[v.term] ?? 0;
      if (delay) await new Promise(r => setTimeout(r, delay));
      return fulfill(route, out);
    }
    return fulfill(route, {});
  });
  return seen;
}

const W = '#role-index_wrapper';

test.describe('native table shell on role-index @mocked', () => {
  test.beforeEach(async ({ page }) => {
    // Each test starts from default state: the table saves page/length/order/search per path.
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('first load: default order, info line, length menu, DataTables-compatible markup', async ({ page }) => {
    const seen = await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator(`${W} .dt-length select`)).toHaveValue('10');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-search input`)).toBeVisible();
    // Default order is Name, descending, sent as the first request.
    expect(seen[0].page).toEqual({ sort: [{ key: 'name', value: 'desc' }], size: 10, page: 0 });
    await expect(page.locator('#role-index thead th').first()).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('#role-index tbody tr').first()).toContainText('Role 23');
    // full_numbers pager: first/previous/pages/next/last
    for (const cls of ['first', 'previous', 'next', 'last']) {
      await expect(page.locator(`${W} .dt-paging button.page-link.${cls}`)).toHaveCount(1);
    }
    await expect(page.locator(`${W} .dt-paging li.dt-paging-button.active`)).toHaveText('1');
  });

  test('paging: next, last, previous, first and the info line follow', async ({ page }) => {
    const seen = await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await expect(page.locator(`${W} .dt-paging button.page-link.first`)).toHaveAttribute('aria-disabled', 'true');

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    expect(seen.at(-1)!.page.page).toBe(1);

    await page.locator(`${W} .dt-paging button.page-link.last`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 21 to 23 of 23 entries');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(3);
    await expect(page.locator(`${W} .dt-paging button.page-link.next`)).toHaveAttribute('aria-disabled', 'true');

    await page.locator(`${W} .dt-paging button.page-link.previous`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await page.locator(`${W} .dt-paging button.page-link.first`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    // A numbered page button
    await page.locator(`${W} .dt-paging button.page-link`, { hasText: /^3$/ }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 21 to 23 of 23 entries');
  });

  test('page length: changing it refetches from page 0 with the new size', async ({ page }) => {
    const seen = await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await page.locator(`${W} .dt-length select`).selectOption('25');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(23);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 23 of 23 entries');
    expect(seen.at(-1)!.page).toMatchObject({ size: 25, page: 0 });
  });

  test('sort cycle (#336): header click reverses, never clears; a new column starts ascending', async ({ page }) => {
    const seen = await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    const nameTh = page.locator('#role-index thead th').nth(0);
    const descTh = page.locator('#role-index thead th').nth(1);

    // Name is sorted desc on load: one click reverses to ascending (the old DataTables cleared it).
    await nameTh.click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
    expect(seen.at(-1)!.page.sort).toEqual([{ key: 'name', value: 'asc' }]);
    await expect(page.locator('#role-index tbody tr').first()).toContainText('Role 01');

    await nameTh.click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'descending');
    expect(seen.at(-1)!.page.sort).toEqual([{ key: 'name', value: 'desc' }]);

    await nameTh.click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
    expect(seen.at(-1)!.page.sort).toEqual([{ key: 'name', value: 'asc' }]);

    // Another column starts ascending and the first loses its indicator.
    await descTh.click();
    await expect(descTh).toHaveAttribute('aria-sort', 'ascending');
    await expect(nameTh).not.toHaveAttribute('aria-sort', /.+/);
    expect(seen.at(-1)!.page.sort).toEqual([{ key: 'description', value: 'asc' }]);

    // Sorting returns to the first page.
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await descTh.click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
  });

  test('sort is reachable from the keyboard', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await page.locator('#role-index thead th').nth(1).locator('.dt-column-order').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#role-index thead th').nth(1)).toHaveAttribute('aria-sort', 'ascending');
  });

  test('search: throttled while typing, immediate on Enter, resets the page, shows the filtered info line', async ({ page }) => {
    const seen = await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');

    const box = page.locator(`${W} .dt-search input`);
    const before = seen.length;
    await box.pressSequentially('Role 1', { delay: 30 });
    // Inside the 400 ms throttle nothing has been sent yet.
    await page.waitForTimeout(150);
    expect(seen.length, 'no request while the user is still typing').toBe(before);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 10 entries (filtered from 23 total entries)');
    expect(seen.length - before, 'one request for the whole burst of keystrokes').toBe(1);
    expect(seen.at(-1)).toMatchObject({ term: 'Role 1', page: { page: 0 } });

    // Enter searches at once, without waiting for the throttle.
    await box.fill('Role 2');
    const n = seen.length;
    await box.press('Enter');
    await expect.poll(() => seen.length).toBe(n + 1);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 4 of 4 entries (filtered from 23 total entries)');

    // No match: empty state, zero info line.
    await box.fill('zzz');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 0 to 0 of 0 entries (filtered from 23 total entries)');
    await expect(page.locator('#role-index td.no-data-available')).toHaveText('No data!');
  });

  test('a slow older search never overwrites a newer one', async ({ page }) => {
    await installMocks(page, { delayFor: { 'Role 05': 2_000 } });
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Role 05');
    await box.press('Enter');
    await box.fill('Role 07');
    await box.press('Enter');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(1);
    await expect(page.locator('#role-index tbody tr')).toContainText('Role 07');
    await page.waitForTimeout(2_500);
    await expect(page.locator('#role-index tbody tr')).toHaveCount(1);
    await expect(page.locator('#role-index tbody tr')).toContainText('Role 07');
  });

  test('row click toggles the selected class', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/roles');
    const row = page.locator('#role-index tbody tr').first();
    await row.locator('td').first().click({ position: { x: 300, y: 5 } });
    await expect(row).toHaveClass(/selected/);
    await row.locator('td').first().click({ position: { x: 300, y: 5 } });
    await expect(row).not.toHaveClass(/selected/);
  });

  test('a failed request empties the table and warns instead of leaving stale rows', async ({ page }) => {
    await installMocks(page, { fail: true });
    await page.goto('/dashboard/roles');
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 0 to 0 of 0 entries');
  });

  test('page length, order and search survive leaving and returning (stateSave parity)', async ({ page }) => {
    await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    await page.locator(`${W} .dt-length select`).selectOption('5');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(5);
    await page.locator('#role-index thead th').nth(1).click();
    await page.locator(`${W} .dt-search input`).fill('Role 1');
    await page.locator(`${W} .dt-search input`).press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toContainText('of 10 entries');
    // Leave the page and come back: the full reload keeps the saved state (cleared only once per tab).
    await page.goto('/dashboard/users');
    await page.goto('/dashboard/roles');
    await expect(page.locator(`${W} .dt-length select`)).toHaveValue('5');
    await expect(page.locator(`${W} .dt-search input`)).toHaveValue('Role 1');
    await expect(page.locator('#role-index thead th').nth(1)).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator(`${W} .dt-info`)).toContainText('Showing 1 to 5 of 10 entries');
  });
});
