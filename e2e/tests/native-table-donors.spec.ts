/**
 * Native tables (#113, milestone 6) — parity cover for the three donor tables: donor-index,
 * donor-parent-index and the embedded donor-component (the Individual Donors tab of a parent).
 *
 * What must not change when a DataTables page becomes a cta-table:
 *  - table ids (`donor-index` is ALSO the id of the embedded donor-component's table, which is
 *    hard-coded in its template), page length 10, length menu, `simple_numbers` pager, info line,
 *  - default order (Created desc: column 5 on the donor tables, column 4 on the parents) and the
 *    real sort keys, including the nested `donorParent.name`,
 *  - the select column is inert; the sort cycle reverses and never clears (#336),
 *  - the Filter modal: a saved filter is restored BEFORE the first request, applying it reloads
 *    and keeps the page, the badge counts the choices,
 *  - the parent table derives its device count with map + spread (Apollo v4 frozen rows),
 *  - the embedded table sends the parent's `where` and a `filter`.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  where?: any;
  filter?: any;
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const pad = (n: number) => String(n).padStart(2, '0');

const DONORS = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, name: `Donor ${pad(i + 1)}`, postCode: `SW${i + 1} 0AA`, phoneNumber: `0770090${pad(i + 1)}`, email: `d${pad(i + 1)}@example.org`,
  kitCount: i % 5, createdAt: `2026-01-${pad(i + 1)}T10:00:00Z`, updatedAt: '2026-02-01T00:00:00Z', archived: i === 22, isLeadContact: false,
  donorParent: { id: (i % 3) + 1, name: `Parent ${(i % 3) + 1}` },
}));

const PARENTS = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: `Parent ${pad(i + 1)}`, address: `${i + 1} High St`, website: '', donorCount: i % 4, type: i % 2 ? 'DROPPOINT' : 'BUSINESS',
  createdAt: `2026-01-${pad(i + 1)}T10:00:00Z`, updatedAt: '2026-02-01T00:00:00Z', archived: i === 11,
  donors: [{ id: 1, kitCount: 2 }, { id: 2, kitCount: i }],
}));

interface State { donors: { vars: Vars; embedded: boolean }[]; parents: Vars[] }

async function installMocks(page: Page): Promise<State> {
  const st: State = { donors: [], parents: [] };
  const slice = <T,>(rows: T[], v: Vars) => rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size);
  const sorted = <T,>(rows: T[], v: Vars, pick: (r: T, k: string) => string | number) => {
    const key = v.page!.sort[0]?.key ?? 'createdAt';
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

    if (op === 'findAllDonors') {
      const embedded = !!v.where?.donorParent;
      st.donors.push({ vars: v, embedded });
      const term = (v.term ?? '').toLowerCase();
      const archived = (embedded ? v.filter : v.where)?.archived?._in as boolean[] | undefined;
      const rows = DONORS.filter(d => d.name.toLowerCase().includes(term) && (!archived || archived.includes(d.archived))
        && (!embedded || d.donorParent.id === v.where.donorParent.id._eq));
      const out = sorted(rows, v, (r, k) => (k === 'donorParent.name' ? r.donorParent.name : (r as any)[k]));
      return fulfill(route, { donorsConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (op === 'findAllDonorParents') {
      st.parents.push(v);
      const term = (v.term ?? '').toLowerCase();
      const archived = v.where?.archived?._in as boolean[] | undefined;
      const type = v.where?.type?._in as string[] | undefined;
      const rows = PARENTS.filter(p => p.name.toLowerCase().includes(term) && (!archived || archived.includes(p.archived)) && (!type || type.includes(p.type)));
      const out = sorted(rows, v, (r, k) => (r as any)[k]);
      return fulfill(route, { donorParentsConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (q.includes('findDonorParent(')) {
      return fulfill(route, { donorParent: { ...PARENTS[0], donors: [] } });
    }
    return fulfill(route, {});
  });
  return st;
}

const lastDonors = (st: State, embedded = false) => st.donors.filter(d => d.embedded === embedded).at(-1)!.vars;

test.describe('native tables: donors @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_') || k.startsWith('donor')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('donor-index: 10 per page, Created desc, nested parent sort key, inert select column, paging, search', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/donors');
    const W = '#donor-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(0); // simple_numbers
    expect(lastDonors(st)).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'createdAt', value: 'desc' }] }, where: {} });
    await expect(page.locator('#donor-index tbody tr').first()).toContainText('Donor 23');
    const th = page.locator('#donor-index thead th');
    await expect(th.nth(5)).toHaveAttribute('aria-sort', 'descending');

    await th.nth(4).click();
    await expect(th.nth(4)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => lastDonors(st).page!.sort).toEqual([{ key: 'donorParent.name', value: 'asc' }]);
    await th.nth(2).click();
    await expect(th.nth(2)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => lastDonors(st).page!.sort).toEqual([{ key: 'kitCount', value: 'asc' }]);
    await th.nth(2).click();
    await expect(th.nth(2)).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => lastDonors(st).page!.sort).toEqual([{ key: 'kitCount', value: 'desc' }]);
    const before = st.donors.length;
    await th.nth(0).click();
    await page.waitForTimeout(300);
    expect(st.donors.length).toBe(before);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 23 entries');
    expect(lastDonors(st).page).toMatchObject({ size: 10, page: 1 });
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Donor 1');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 10 entries (filtered from 23 total entries)');
    expect(lastDonors(st).term).toBe('Donor 1');

    // Row render: name link, email under it, devices badge, parent link.
    const row = page.locator('#donor-index tbody tr').first();
    await expect(row.locator('td').nth(1)).toContainText('@example.org');
    await expect(row.locator('td').nth(2).locator('.badge-info')).toHaveCount(1);
    await expect(row.locator('td').nth(4).locator('a')).toHaveAttribute('href', /donor-parents\/\d$/);
  });

  test('donor-index: saved filter reaches the first request; Filter modal reloads and counts', async ({ page }) => {
    const st = await installMocks(page);
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-seeded')) {
          sessionStorage.setItem('cta-test-seeded', '1');
          localStorage.setItem('donorFilters-donor-index', JSON.stringify({ archived: [true] }));
        }
      } catch { /* ignore */ }
    });
    await page.goto('/dashboard/donors');
    const W = '#donor-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entries');
    expect(st.donors[0].vars.where).toEqual({ archived: { _in: [true] } });
    await expect(page.locator('.card-header .badge-danger')).toHaveText('1');

    await page.getByRole('link', { name: /Filter/ }).click();
    const modal = page.locator('.modal-content');
    await modal.getByText('Active Donors').click();
    await modal.getByRole('button', { name: 'Filter' }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    await expect(page.locator('.card-header .badge-danger')).toHaveText('2');
  });

  test('donor-parent-index: Created desc (column 4), donor/device counts, Type filter', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/donor-parents');
    const W = '#donor-parent-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 12 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    expect(st.parents.at(-1)).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'createdAt', value: 'desc' }] }, where: {} });
    const th = page.locator('#donor-parent-index thead th');
    await expect(th.nth(4)).toHaveAttribute('aria-sort', 'descending');
    // Newest first: Parent 12 (donorCount 3; devices 2 + 11 = 13, derived with map + spread).
    const first = page.locator('#donor-parent-index tbody tr').first();
    await expect(first).toContainText('Parent 12');
    await expect(first.locator('td').nth(3)).toHaveText('3 / 13');

    await th.nth(3).click();
    await expect(th.nth(3)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => st.parents.at(-1)!.page!.sort).toEqual([{ key: 'donorCount', value: 'asc' }]);
    await th.nth(6).click();
    await expect(th.nth(6)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => st.parents.at(-1)!.page!.sort).toEqual([{ key: 'type', value: 'asc' }]);
    const before = st.parents.length;
    await th.nth(0).click();
    await page.waitForTimeout(300);
    expect(st.parents.length).toBe(before);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 12 of 12 entries');

    await page.getByRole('link', { name: /Filter/ }).click();
    const modal = page.locator('.modal-content');
    await modal.getByText('Business', { exact: true }).click();
    await modal.getByRole('button', { name: 'Filter' }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText(/of 6 entries \(filtered from 12 total entries\)|of 6 entries/);
    expect(st.parents.at(-1)!.where.type).toEqual({ _in: ['BUSINESS'] });
    await expect(page.locator('.card-header .badge-danger')).toHaveText('1');
  });

  test('parent donor: the Individual Donors tab sends the parent where and keeps id donor-index', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/donor-parents/1');
    await page.getByRole('tab', { name: 'Individual Donors' }).click();
    const W = '#donor-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 8 of 8 entries');
    await expect(page.locator('#donor-index tbody tr')).toHaveCount(8);
    expect(lastDonors(st, true)).toMatchObject({
      page: { size: 10, page: 0, sort: [{ key: 'createdAt', value: 'desc' }] },
      where: { donorParent: { id: { _eq: 1 } } },
      filter: {},
    });
    await expect(page.locator('#donor-index tbody tr').first()).toContainText('Donor 22');
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Donor 07');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entries (filtered from 8 total entries)');
  });
});
