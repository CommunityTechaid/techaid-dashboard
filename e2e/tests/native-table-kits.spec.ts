/**
 * Native tables (#113, milestone 8b) — parity cover for kit-index (the Devices list).
 *
 * The behaviour suites are `kit-id-list-bulk-update` (ID-list search, matched selection, mixed-status
 * warning), `exclude-status-filter`, `issue-76-kit-filter-reset` and `kit-locked-status`. This file pins
 * what is specific to the DataTables -> cta-table move:
 *  - ids, 10 per page, length menu, `simple_numbers` pager, info line,
 *  - default order Make desc, the real sort keys, the inert id / select column,
 *  - the saved filter (or the Active-only default) reaches the FIRST request, and it is the only one,
 *  - the select-all checkbox lives in the header cell (shell `ctaHeader` template) in bulk mode only,
 *    selects the page, and warns when the result set is bigger than the page,
 *  - a bulk update and a quick create reload the table on the CURRENT page,
 *  - the exclude-status choice goes to the server as `_neq` constraints,
 *  - a failed request toasts and empties the table.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  where?: any;
}

const W = '#kit-index_wrapper';
const pad = (n: number) => String(n).padStart(2, '0');

const KITS = Array.from({ length: 23 }, (_, i) => ({
  id: 1000 + i + 1, make: `Make ${pad(i + 1)}`, model: `Model ${pad(i + 1)}`, age: 2, type: 'LAPTOP', status: 'DONATION_NEW',
  location: 'Store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', lotId: null,
  donor: i === 0 ? { id: 9001, name: 'Dora Donor', email: 'dora@example.org' } : null, deviceRequest: null,
}));

interface State { kits: Vars[]; mutations: string[]; failNext: number }

async function installMocks(page: Page, seed?: Record<string, string>): Promise<State> {
  const st: State = { kits: [], mutations: [], failNext: 0 };
  await page.addInitScript((s) => {
    try {
      if (!sessionStorage.getItem('cta-test-cleared')) {
        sessionStorage.setItem('cta-test-cleared', '1');
        Object.keys(localStorage).filter(k => k.startsWith('cta-table_') || k.startsWith('kitFilters')).forEach(k => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(s ?? {})) localStorage.setItem(k, v);
      }
    } catch { /* ignore */ }
  }, seed ?? {});
  const ok = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return ok(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return ok(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const q: string = body.query ?? raw;
    const v: Vars = body.variables ?? {};
    if (q.includes('findAllKits')) {
      st.kits.push(v);
      if (st.failNext > 0) {
        st.failNext--;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'stub failure' }], data: null }) });
      }
      const key = v.page!.sort[0]?.key ?? 'id';
      const dir = v.page!.sort[0]?.value === 'desc' ? -1 : 1;
      const rows = [...KITS].sort((a: any, b: any) => dir * String(a[key] ?? '').localeCompare(String(b[key] ?? '')));
      return ok(route, { kitsConnection: { totalElements: rows.length, number: v.page!.page, content: rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size) } });
    }
    if (q.includes('updateKits')) { st.mutations.push('updateKits'); return ok(route, { updateKits: [] }); }
    if (q.includes('quickCreateKit')) { st.mutations.push('quickCreateKit'); return ok(route, { quickCreateKit: { id: 5000, type: 'LAPTOP', model: 'New', donor: null } }); }
    if (q.includes('findAutocompleteDeviceRequests')) return ok(route, { deviceRequestConnection: { content: [] } });
    if (q.includes('findAutocompleteDonors')) return ok(route, { donorsConnection: { content: [] } });
    if (q.includes('findAutocompleteDonorParents')) return ok(route, { donorParentsConnection: { content: [] } });
    if (q.includes('findAutocompleteLotIds')) return ok(route, { kitsConnection: { content: [] } });
    return ok(route, {});
  });
  return st;
}

test.describe('native tables: devices list @mocked', () => {
  test('10 per page, Make desc, one first request with the Active-only default, sort keys, inert column', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(st.kits.length).toBe(1);
    expect(st.kits[0]).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'make', value: 'desc' }] }, where: { archived: { _in: [false] } }, term: '' });
    await expect(page.locator('#kit-index tbody tr').first()).toContainText('Make 23');

    const th = page.locator('#kit-index thead th');
    await expect(th.nth(1)).toHaveAttribute('aria-sort', 'descending');
    const sorts: [number, string][] = [[2, 'model'], [3, 'donor'], [4, 'createdAt'], [5, 'updatedAt'], [6, 'type'], [7, 'status'], [1, 'make']];
    for (const [col, key] of sorts) {
      await th.nth(col).click();
      await expect(th.nth(col)).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(() => st.kits.at(-1)!.page!.sort).toEqual([{ key, value: 'asc' }]);
    }
    const before = st.kits.length;
    await th.nth(0).click();
    await page.waitForTimeout(300);
    expect(st.kits.length).toBe(before);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Model 03');
    await box.press('Enter');
    await expect.poll(() => st.kits.at(-1)).toMatchObject({ term: 'Model 03', page: { page: 0 } });
  });

  test('a saved filter and the exclude-status choice reach the first request, and it is the only one', async ({ page }) => {
    const st = await installMocks(page, {
      'kitFilters-kit-index': JSON.stringify({ archived: [false], type: ['LAPTOP'], statusExclude: ['DONATION_NEW'] }),
    });
    await page.goto('/dashboard/devices');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await page.waitForTimeout(500);
    expect(st.kits.length).toBe(1);
    expect(st.kits[0].where).toMatchObject({ type: { _in: ['LAPTOP'] }, archived: { _in: [false] }, AND: [{ status: { _neq: 'DONATION_NEW' } }] });
    await expect(page.locator('.card-header .text-bg-danger')).toHaveText('3');
  });

  test('bulk mode: the select-all checkbox is in the header, selects the page and warns about the rest', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    const header = page.locator('#kit-index thead th').first();
    await expect(header.locator('input[type=checkbox]')).toHaveCount(0);
    await page.locator('label.custom-control-label', { hasText: 'Bulk Update' }).click();
    await expect(header.locator('input[type=checkbox]')).toBeVisible();
    await header.locator('input[type=checkbox]').check();
    await expect(page.locator('#kit-index tbody tr.selected')).toHaveCount(10);
    await expect(page.locator('.toast-warning')).toContainText('Only the 10 devices on this page are selected');
    await expect(page.locator('.toast-warning')).toContainText('23');
    await expect(header.locator('input[type=checkbox]')).toBeChecked();
    // The same header control clears it again, and moving page unticks it.
    await header.locator('input[type=checkbox]').uncheck();
    await expect(page.locator('#kit-index tbody tr.selected')).toHaveCount(0);
    await page.locator('#kit-index tbody tr').nth(2).click();
    await expect(page.locator('#kit-index tbody tr.selected')).toHaveCount(1);
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await expect(header.locator('input[type=checkbox]')).not.toBeChecked();
    expect(st.kits.at(-1)!.page!.page).toBe(1);
  });

  test('a bulk update reloads on the current page and clears the selection', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await page.locator('label.custom-control-label', { hasText: 'Bulk Update' }).click();
    await page.locator('#kit-index tbody tr').first().click();
    await page.locator('label.custom-control-label .btn-warning').click();
    const modal = page.locator('ngb-modal-window');
    await modal.locator('ng-select').click();
    await page.locator('.ng-dropdown-panel .ng-option').first().click();
    const before = st.kits.length;
    await modal.getByRole('button', { name: 'UPDATE' }).click();
    await expect.poll(() => st.mutations).toContain('updateKits');
    await expect.poll(() => st.kits.length).toBe(before + 1);
    expect(st.kits.at(-1)!.page!.page).toBe(1);
    await expect(page.locator('#kit-index tbody tr.selected')).toHaveCount(0);
  });

  test('creating a device reloads on the current page', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/devices');
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    await page.locator('[data-testid="kit-create-open"]').click();
    await page.locator('ngb-modal-window input[type=text]').nth(1).fill('Latitude 7400');
    const before = st.kits.length;
    await page.locator('[data-testid="kit-create-submit"]').click();
    await expect.poll(() => st.mutations).toContain('quickCreateKit');
    await expect.poll(() => st.kits.length).toBe(before + 1);
    expect(st.kits.at(-1)!.page!.page).toBe(1);
  });

  test('a failed request toasts, empties the table, and the next page works', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/devices');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    st.failNext = 1;
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error');
    await expect(page.locator('#kit-index tbody tr a')).toHaveCount(0);
    await page.locator(`${W} .dt-length select`).selectOption('25');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 23 of 23 entries');
  });
});
