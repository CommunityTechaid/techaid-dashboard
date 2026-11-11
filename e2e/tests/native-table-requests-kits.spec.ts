/**
 * Native tables (#113, milestone 7) — parity cover for device-request-index, the embedded
 * device-request-component (Requests tab of an organisation) and the embedded kit-component
 * (Devices tab of a donor).
 *
 * What must not change when a DataTables page becomes a cta-table:
 *  - ids, page lengths (10 / 10 / 5), length menu, `simple_numbers` pager, info line,
 *  - default order ID desc (kit-component: Make desc), the real sort keys (including the nested
 *    referee / organisation paths and `borough`), inert Requests / Is Prepped / select columns,
 *  - the default `is_sales: [false]` filter and a saved filter reach the FIRST request,
 *  - the numeric search term ("12" also searches request id 12; text sends -1),
 *  - rows derived in `source` with map + spread: the stacked Requests cell (requested vs allocated
 *    per device type, kit id links) and the kit table's donor name,
 *  - the embedded tables send the parent's `where`.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  numericterm?: number;
  where?: any;
  filter?: any;
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const pad = (n: number) => String(n).padStart(2, '0');

const REQUESTS = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, status: 'NEW', clientRef: `REF-${pad(i + 1)}`, borough: i % 2 ? 'Lambeth' : '',
  deviceRequestItems: { phones: 0, tablets: 0, laptops: 2, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
  kits: i === 22 ? [{ id: 501, type: 'LAPTOP' }, { id: 502, type: 'LAPTOP' }] : [],
  referringOrganisationContact: { id: 7, fullName: `Referee ${pad(i + 1)}`, referringOrganisation: { id: 3, name: `Org ${pad(23 - i)}` } },
  isPrepped: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: `2026-02-${pad(i + 1)}T10:00:00Z`,
}));

const KITS = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, make: `Make ${pad(i + 1)}`, model: `Model ${pad(i + 1)}`, age: 1, type: 'LAPTOP', status: 'DONATION_NEW', location: 'Store',
  updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', archived: false,
  donor: { id: 9001, name: 'Dora Donor', email: 'dora@example.org' }, deviceRequest: null,
}));

interface State { index: Vars[]; embedded: Vars[]; kits: Vars[] }

async function installMocks(page: Page): Promise<State> {
  const st: State = { index: [], embedded: [], kits: [] };
  const slice = <T,>(rows: T[], v: Vars) => rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size);
  const sortBy = <T,>(rows: T[], v: Vars, pick: (r: T, k: string) => string | number) => {
    const key = v.page!.sort[0]?.key ?? 'id';
    const dir = v.page!.sort[0]?.value === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = pick(a, key), y = pick(b, key);
      return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  };

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const v: Vars = body.variables ?? {};
    const q: string = body.query ?? raw;
    const op = /(?:query|mutation)\s+(\w+)/.exec(q)?.[1] ?? '';

    const pickRequest = (r: any, k: string) => (k === 'referringOrganisationContact.fullName' ? r.referringOrganisationContact.fullName
      : k === 'referringOrganisationContact.referringOrganisation.name' ? r.referringOrganisationContact.referringOrganisation.name : r[k]);
    if (op === 'findAllDeviceRequests') {
      st.index.push(v);
      const term = (v.term ?? '').toLowerCase();
      const rows = REQUESTS.filter(r => r.clientRef.toLowerCase().includes(term) || r.id === v.numericterm);
      const out = sortBy(rows, v, pickRequest);
      return fulfill(route, { deviceRequestConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (op === 'findAllOrgs') {
      st.embedded.push(v);
      const term = (v.term ?? '').toLowerCase();
      const rows = REQUESTS.slice(0, 12).filter(r => r.clientRef.toLowerCase().includes(term));
      const out = sortBy(rows, v, pickRequest);
      return fulfill(route, { deviceRequestConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (op === 'findAllKits') {
      st.kits.push(v);
      const term = (v.term ?? '').toLowerCase();
      const rows = KITS.filter(k => k.make.toLowerCase().includes(term));
      const out = sortBy(rows, v, (r, k) => (r as any)[k]);
      return fulfill(route, { kitsConnection: { totalElements: out.length, number: 0, content: slice(out, v) } });
    }
    if (q.includes('findDonor(')) {
      return fulfill(route, { donor: { id: 9001, name: 'Dora Donor', postCode: 'SW9 0AA', phoneNumber: '07700900000', email: 'dora@example.org', referral: '', archived: false, isLeadContact: false, donorParent: null, kits: [] } });
    }
    if (q.includes('findReferringOrganisation(')) {
      return fulfill(route, { referringOrganisation: { id: 3, phoneNumber: '07700900000', name: 'Org 01', website: '', archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } });
    }
    return fulfill(route, {});
  });
  return st;
}

test.describe('native tables: requests and devices @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_') || k.startsWith('deviceRequestFilters') || k.startsWith('orgFilters') || k.startsWith('kitFilters')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('device-request-index: 10 per page, ID desc, default filter, sort keys, inert columns, numeric search', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/device-requests');
    const W = '#device-request-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(0);
    // The default Non-commercial filter reached the very first request (no wasted unfiltered one).
    expect(st.index[0]).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'id', value: 'desc' }] }, filter: { isSales: { _in: [false] } }, term: '', numericterm: 0 });
    const th = page.locator('#device-request-index thead th');
    await expect(th.nth(0)).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('#device-request-index tbody tr').first()).toContainText('REF-23');

    // Stacked Requests cell, derived in source: 2 requested, 2 allocated, kit id links.
    const first = page.locator('#device-request-index tbody tr').first();
    await expect(first.locator('td').nth(1)).toContainText('Laptops');
    await expect(first.locator('td').nth(1)).toContainText('2  / 2');
    await expect(first.locator('td').nth(1).locator('a.badge-light')).toHaveText(['501', '502']);
    // The Borough column renders "Not recorded" for a blank borough.
    await expect(page.locator('#device-request-index tbody tr').nth(1).locator('td').nth(4)).toContainText('Lambeth');

    const sorts: [number, string][] = [[2, 'referringOrganisationContact.fullName'], [3, 'referringOrganisationContact.referringOrganisation.name'], [4, 'borough'], [5, 'clientRef'], [8, 'status']];
    for (const [col, key] of sorts) {
      await th.nth(col).click();
      await expect(th.nth(col)).toHaveAttribute('aria-sort', 'ascending');
      await expect.poll(() => st.index.at(-1)!.page!.sort).toEqual([{ key, value: 'asc' }]);
    }
    await th.nth(8).click();
    await expect(th.nth(8)).toHaveAttribute('aria-sort', 'descending');
    const before = st.index.length;
    await th.nth(1).click();
    await th.nth(9).click();
    await page.waitForTimeout(300);
    expect(st.index.length).toBe(before);
    await expect(th.nth(1)).not.toHaveAttribute('aria-sort', /.+/);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('12');
    await box.press('Enter');
    await expect.poll(() => st.index.at(-1)).toMatchObject({ term: '12', numericterm: 12 });
    await box.fill('REF-1');
    await box.press('Enter');
    await expect.poll(() => st.index.at(-1)).toMatchObject({ term: 'REF-1', numericterm: -1 });
  });

  test('device-request-index: a saved filter reaches the first request', async ({ page }) => {
    const st = await installMocks(page);
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-seeded')) {
          sessionStorage.setItem('cta-test-seeded', '1');
          localStorage.setItem('deviceRequestFilters-device-request-index', JSON.stringify({ is_sales: [true], borough: ['Lambeth'] }));
        }
      } catch { /* ignore */ }
    });
    await page.goto('/dashboard/device-requests');
    await expect(page.locator('#device-request-index_wrapper .dt-info')).toHaveText('Showing 1 to 10 of 23 entries');
    expect(st.index[0].filter).toEqual({ isSales: { _in: [true] }, borough: { _in: ['Lambeth'] } });
    await expect(page.locator('.card-header .badge-danger')).toHaveText('2');
  });

  test('organisation Requests tab: 10 per page, ID desc, sends the organisation where', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/referring-organisations/3');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Device Requests' }).click();
    const T = '#referring-organisation-devices-3';
    await expect(page.locator(`${T}_wrapper .dt-info`)).toHaveText('Showing 1 to 10 of 12 entries');
    expect(st.embedded.at(-1)).toMatchObject({
      page: { size: 10, page: 0, sort: [{ key: 'id', value: 'desc' }] },
      filter: { referringOrganisationContact: { referringOrganisation: { id: { _eq: 3 } } } },
      where: {},
    });
    await expect(page.locator(`${T} tbody tr`).first()).toContainText('REF-12');
    // Requests (kit count) is sortable on this table, unlike the index.
    const th = page.locator(`${T} thead th`);
    await th.nth(1).click();
    await expect.poll(() => st.embedded.at(-1)!.page!.sort).toEqual([{ key: 'kitCount', value: 'asc' }]);
    await page.locator(`${T}_wrapper .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${T}_wrapper .dt-info`)).toHaveText('Showing 11 to 12 of 12 entries');
  });

  test('donor Devices tab: 5 per page, Make desc, nested donor sort key, donor name derived', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/donors/9001');
    await page.getByRole('tab', { name: 'Devices' }).click();
    const W = '#donor-info-9001_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 8 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    expect(st.kits.at(-1)).toMatchObject({
      page: { size: 5, page: 0, sort: [{ key: 'make', value: 'desc' }] },
      filter: { donor: { id: { _eq: 9001 } } },
    });
    await expect(page.locator('#donor-info-9001 tbody tr').first()).toContainText('Make 08');
    await expect(page.locator('#donor-info-9001 tbody tr').first()).toContainText('Dora Donor');
    const th = page.locator('#donor-info-9001 thead th');
    await th.nth(3).click();
    await expect(th.nth(3)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => st.kits.at(-1)!.page!.sort).toEqual([{ key: 'donor', value: 'asc' }]);
    const before = st.kits.length;
    await th.nth(0).click();
    await page.waitForTimeout(300);
    expect(st.kits.length).toBe(before);
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 8 of 8 entries');
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Make 03');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entry (filtered from 8 total entries)');
  });
});
