/**
 * Native tables (#113, milestone 8a) — parity cover for distributions-and-deliveries-index.
 *
 * The behaviour suite is `distributions-and-deliveries-table.spec.ts` (filters, quick buttons, URL
 * state, reset, slots tab). This file pins what is specific to the DataTables -> cta-table move:
 *  - ids, 10 per page, length menu, `simple_numbers` pager (no first/last), ID desc,
 *  - the real sort keys, and the inert Requests / Is Prepped headers (no request on click),
 *  - the filter (default non-commercial, or saved filter + quick week) reaches the FIRST request,
 *    and that request is the only one (the old `deferLoading` workaround is no longer needed),
 *  - a header click never produces a "no order" state,
 *  - applying a filter or a quick button goes back to the first page (`reload(true)`),
 *  - the empty state says "No matching records found",
 *  - after a failed request the pager keeps the last known total,
 *  - the Requests header keeps its tooltip, saved state lives under the `cta-table_` key.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  numericterm?: number;
  filter?: any;
}

const PATH = '/dashboard/distributions-and-deliveries';
const ID = 'distributions-and-deliveries-index';
const W = `#${ID}_wrapper`;
const pad = (n: number) => String(n).padStart(2, '0');

const ROWS = Array.from({ length: 27 }, (_, i) => ({
  id: i + 1, status: 'NEW', clientRef: `REF-${pad(i + 1)}`, collectionMethod: 'DELIVERY', collectionDate: null,
  deviceRequestItems: { phones: 0, tablets: 0, laptops: 1, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0 },
  kits: [], isPrepped: false,
  referringOrganisationContact: { id: 7, fullName: `Referee ${pad(i + 1)}`, referringOrganisation: { id: 3, name: `Org ${pad(i + 1)}` } },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
}));

interface State { reqs: Vars[]; failNext: number }

async function installMocks(page: Page, opts: { seed?: Record<string, string>; empty?: boolean } = {}): Promise<State> {
  const st: State = { reqs: [], failNext: 0 };
  await page.addInitScript((seed) => {
    try {
      if (!sessionStorage.getItem('cta-test-cleared')) {
        sessionStorage.setItem('cta-test-cleared', '1');
        Object.keys(localStorage)
          .filter(k => k.startsWith('cta-table_') || k.startsWith('distributionsAndDeliveriesFilters'))
          .forEach(k => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(seed ?? {})) localStorage.setItem(k, v);
      }
    } catch { /* ignore */ }
  }, opts.seed ?? {});
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (raw.includes('buildInfo')) return ok({ buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return ok({ featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    if ((body.query ?? raw).includes('findAllDeviceRequests')) {
      const v: Vars = body.variables ?? {};
      st.reqs.push(v);
      if (st.failNext > 0) {
        st.failNext--;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'stub failure' }], data: null }) });
      }
      const term = (v.term ?? '').toLowerCase();
      const rows = opts.empty ? [] : ROWS.filter(r => r.clientRef.toLowerCase().includes(term));
      const dir = v.page!.sort[0]?.value === 'asc' ? 1 : -1;
      const sorted = [...rows].sort((a, b) => dir * (a.id - b.id));
      return ok({ deviceRequestConnection: { totalElements: sorted.length, content: sorted.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size) } });
    }
    return ok({});
  });
  return st;
}

test.describe('native tables: distributions and deliveries @mocked', () => {
  test('10 per page, ID desc, one first request carrying the default filter, sort keys, inert headers', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto(PATH);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(st.reqs.length).toBe(1);
    expect(st.reqs[0]).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'id', value: 'desc' }] }, filter: { AND: [], isSales: { _in: [false] } }, term: '', numericterm: 0 });
    await expect(page.locator(`#${ID} tbody tr`).first()).toContainText('REF-27');

    const th = page.locator(`#${ID} thead th`);
    await expect(th.nth(0)).toHaveAttribute('aria-sort', 'descending');
    await expect(th.nth(1)).toHaveAttribute('title', /allocated \/ requested/);
    // Header click: ascending first, then back; never an unsorted state.
    await th.nth(0).click();
    await expect(th.nth(0)).toHaveAttribute('aria-sort', 'ascending');
    await th.nth(0).click();
    await expect(th.nth(0)).toHaveAttribute('aria-sort', 'descending');
    await th.nth(0).click();
    await expect(th.nth(0)).toHaveAttribute('aria-sort', 'ascending');

    const sorts: [number, string][] = [[2, 'referringOrganisationContact.fullName'], [3, 'referringOrganisationContact.referringOrganisation.name'],
      [4, 'clientRef'], [5, 'collectionMethod'], [6, 'collectionDate'], [7, 'createdAt'], [8, 'updatedAt'], [9, 'status']];
    for (const [col, key] of sorts) {
      await th.nth(col).click();
      await expect(th.nth(col)).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(() => st.reqs.at(-1)!.page!.sort).toEqual([{ key, value: 'asc' }]);
    }
    const before = st.reqs.length;
    await th.nth(1).click();
    await th.nth(10).click();
    await page.waitForTimeout(300);
    expect(st.reqs.length).toBe(before);

    // State is saved under the native key, not DataTables'.
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), `cta-table_${ID}_${PATH}`);
    expect(saved).toMatchObject({ size: 10, order: { column: 9, dir: 'asc' } });
  });

  test('a saved filter and quick week reach the first request, and it is the only one', async ({ page }) => {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()));
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const st = await installMocks(page, {
      seed: { [`distributionsAndDeliveriesFilters-${ID}`]: JSON.stringify({ is_sales: [false], is_prepped: [false], quick: { week: key, failed: true, onHold: false } }) },
    });
    await page.goto(PATH);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
    await page.waitForTimeout(500);
    expect(st.reqs.length).toBe(1);
    expect(st.reqs[0].filter.isPrepped).toEqual({ _in: [false] });
    expect(st.reqs[0].filter.status._in).toContain('REQUEST_COLLECTION_DELIVERY_FAILED');
    expect(st.reqs[0].filter.AND.length).toBe(2);
    await expect(page.locator('.card-header .text-bg-danger')).toHaveText('4');
  });

  test('a quick button goes back to the first page; paging and search keep working', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto(PATH);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 27 entries');
    expect(st.reqs.at(-1)!.page!.page).toBe(1);
    await page.getByRole('button', { name: 'On hold' }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
    expect(st.reqs.at(-1)).toMatchObject({ page: { page: 0 }, filter: { status: { _in: ['PROCESSING_ON_HOLD'] } } });

    const box = page.locator(`${W} .dt-search input`);
    await box.fill('REF-1');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 10 entries');
  });

  test('a search with no matches says "No matching records found"', async ({ page }) => {
    await installMocks(page, { empty: true });
    await page.goto(PATH);
    await expect(page.locator(`#${ID}`)).toContainText('No matching records found');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 0 to 0 of 0 entries');
  });

  test('after a failed request the pager keeps its page links and the toast shows', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto(PATH);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
    st.failNext = 1;
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error');
    await expect(page.locator(`#${ID} tbody tr a`)).toHaveCount(0);
    await expect(page.locator(`${W} .dt-paging button.page-link`, { hasText: /^3$/ })).toBeVisible();
    await page.locator(`${W} .dt-paging button.page-link`, { hasText: /^1$/ }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 27 entries');
  });
});
