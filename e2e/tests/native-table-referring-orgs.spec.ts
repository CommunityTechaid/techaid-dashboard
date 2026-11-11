/**
 * Native tables (#113, milestone 5) — parity cover for the three referring-organisation tables:
 * referring-organisation-index, referring-organisation-contact-index and the embedded
 * referring-organisation-contact-component (the referees tab of an organisation).
 *
 * What must not change when a DataTables page becomes a cta-table:
 *  - table ids, page length (10, 10 and 5), length menu, `simple_numbers` pager, info line,
 *  - default order (Updated desc on the indexes, via the real sort key),
 *  - the sort cycle: header click reverses and never clears (#336), the select column is inert,
 *    the referee table sorts the organisation column by `referringOrganisation.name`,
 *  - the Filter modal: the saved filter is restored BEFORE the first request, applying it
 *    reloads (page kept, as `ajax.reload(null, false)` did), the badge counts the choices,
 *  - the embedded table sends the organisation's `where` and creating a referee reloads it,
 *  - creating an organisation reloads the table.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  filter?: { archived?: { _in: boolean[] } };
  where?: any;
  data?: any;
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const pad = (n: number) => String(n).padStart(2, '0');

const ORGS = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, name: `Org ${pad(i + 1)}`, website: `https://org${i + 1}.example.org`, phoneNumber: `0770090${pad(i + 1)}`,
  requestCount: i % 4, createdAt: '2026-01-01T00:00:00Z', updatedAt: `2026-02-${pad(i + 1)}T10:00:00Z`, archived: i === 22,
}));

const REFEREES = Array.from({ length: 12 }, (_, i) => ({
  id: 100 + i, fullName: `Referee ${pad(i + 1)}`, email: `ref${pad(i + 1)}@example.org`, phoneNumber: `0770091${pad(i + 1)}`,
  requestCount: i % 3, referringOrganisation: { id: (i % 2) + 1, name: `Org ${pad((i % 2) + 1)}` },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: `2026-03-${pad(i + 1)}T10:00:00Z`, archived: i === 11,
}));

interface State {
  orgs: Vars[];
  referees: { vars: Vars; embedded: boolean }[];
  created: { op: string; data: any }[];
}

async function installMocks(page: Page): Promise<State> {
  const st: State = { orgs: [], referees: [], created: [] };
  const extraOrgs: any[] = [];
  const extraReferees: any[] = [];
  const slice = <T,>(rows: T[], v: Vars) => rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size);
  const sorted = <T extends Record<string, any>>(rows: T[], v: Vars, pick: (r: T, k: string) => string) => {
    const key = v.page!.sort[0]?.key ?? 'updatedAt';
    const dir = v.page!.sort[0]?.value === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => dir * pick(a, key).localeCompare(pick(b, key)));
  };

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const v: Vars = body.variables ?? {};
    const q: string = body.query ?? raw;
    const op = /(?:query|mutation)\s+(\w+)/.exec(q)?.[1] ?? '';

    if (op === 'findAllReferringOrgs') {
      st.orgs.push(v);
      const term = (v.term ?? '').toLowerCase();
      const archived = v.filter?.archived?._in;
      const rows = [...ORGS, ...extraOrgs].filter(o => o.name.toLowerCase().includes(term) && (!archived || archived.includes(o.archived)));
      const out = sorted(rows, v, (r, k) => String((r as any)[k]));
      return fulfill(route, { referringOrganisationsConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (op === 'createReferringOrganisation') {
      st.created.push({ op, data: v.data });
      extraOrgs.push({ id: 99, name: v.data.name, website: v.data.website, phoneNumber: v.data.phoneNumber, requestCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00Z', archived: false });
      return fulfill(route, { createReferringOrganisation: { id: 99 } });
    }
    if (op === 'findAllReferringOrgContacts') {
      const embedded = !!v.where && JSON.stringify(v.where).includes('referringOrganisation');
      st.referees.push({ vars: v, embedded });
      const term = (v.term ?? '').toLowerCase();
      const archived = v.filter?.archived?._in;
      const rows = [...REFEREES, ...extraReferees].filter(r => r.fullName.toLowerCase().includes(term) && (!archived || archived.includes(r.archived)));
      const out = sorted(rows, v, (r, k) => (k === 'referringOrganisation.name' ? r.referringOrganisation.name : String((r as any)[k])));
      return fulfill(route, { referringOrganisationContactsConnection: { totalElements: out.length, content: slice(out, v) } });
    }
    if (op === 'createReferringOrganisationContact') {
      st.created.push({ op, data: v.data });
      extraReferees.push({ id: 199, fullName: v.data.fullName, email: v.data.email ?? '', phoneNumber: v.data.phoneNumber ?? '', requestCount: 0, referringOrganisation: { id: 1, name: 'Org 01' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00Z', archived: false });
      return fulfill(route, { createReferringOrganisationContact: { id: 199 } });
    }
    if (q.includes('findReferringOrganisation(')) {
      return fulfill(route, { referringOrganisation: { ...ORGS[0], membershipContacts: [] } });
    }
    return fulfill(route, {});
  });
  return st;
}

const lastOrgs = (st: State) => st.orgs.at(-1)!;
const lastReferees = (st: State, embedded = false) => st.referees.filter(r => r.embedded === embedded).at(-1)!.vars;

test.describe('native tables: referring organisations @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_') || k.startsWith('referringOrg')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('organisation index: 10 per page, Updated desc, sort cycle, inert select column, search, paging', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/referring-organisations');
    const W = '#referring-org-index_wrapper';
    // 22 active organisations (one archived): the default Active filter is restored and applied.
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 22 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(0); // simple_numbers
    expect(lastOrgs(st)).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'updatedAt', value: 'desc' }] }, filter: { archived: { _in: [false] } } });
    await expect(page.locator('#referring-org-index tbody tr').first()).toContainText('Org 22');
    const th = page.locator('#referring-org-index thead th');
    await expect(th.nth(6)).toHaveAttribute('aria-sort', 'descending');

    // Header click reverses (never clears), a new column starts ascending; the select column is inert.
    await th.nth(6).click();
    await expect(th.nth(6)).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('#referring-org-index tbody tr').first()).toContainText('Org 01');
    await th.nth(1).click();
    await expect(th.nth(1)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => lastOrgs(st).page!.sort).toEqual([{ key: 'name', value: 'asc' }]);
    const before = st.orgs.length;
    await th.nth(0).click();
    await page.waitForTimeout(300);
    expect(st.orgs.length).toBe(before);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 20 of 22 entries');
    expect(lastOrgs(st).page).toMatchObject({ size: 10, page: 1 });

    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Org 0');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 9 of 9 entries (filtered from 22 total entries)');
    expect(lastOrgs(st).term).toBe('Org 0');

    // Row cells: select badge link, name link, checkbox is inert.
    const row = page.locator('#referring-org-index tbody tr').first();
    await expect(row.locator('td').first().locator('a')).toHaveAttribute('href', /referring-organisations\/\d+$/);
    await expect(row.locator('input[type=checkbox]')).not.toBeChecked();
  });

  test('organisation index: saved filter is used by the first request, Filter modal reloads and counts', async ({ page }) => {
    const st = await installMocks(page);
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-seeded')) {
          sessionStorage.setItem('cta-test-seeded', '1');
          localStorage.setItem('referringOrgFilters-referring-org-index', JSON.stringify({ archived: [true] }));
        }
      } catch { /* ignore */ }
    });
    await page.goto('/dashboard/referring-organisations');
    const W = '#referring-org-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entry');
    await expect(page.locator('#referring-org-index tbody tr')).toHaveCount(1);
    await expect(page.locator('#referring-org-index tbody tr').first()).toContainText('Org 23');
    // The very first request already carried the saved filter (no wasted unfiltered one).
    expect(st.orgs[0].filter).toEqual(expect.objectContaining({ archived: { _in: [true] } }));
    await expect(page.locator('.card-header .badge-danger')).toHaveText('1');

    // Page 2, then change the filter: the table reloads and keeps its page.
    await page.getByRole('link', { name: /Filter/ }).click();
    const modal = page.locator('.modal-content');
    await modal.getByText('Active Organisations').click();
    await modal.getByRole('button', { name: 'Filter' }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    expect(lastOrgs(st).filter!.archived!._in.sort()).toEqual([false, true]);
    await expect(page.locator('.card-header .badge-danger')).toHaveText('2');
  });

  test('organisation index: creating an organisation reloads the table', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/referring-organisations');
    const W = '#referring-org-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 22 entries');
    await page.getByTestId('org-create-open').click();
    const inputs = page.locator('.modal-body input');
    await inputs.nth(0).fill('Brand New Org');
    await inputs.nth(1).fill('https://brand-new.example.org');
    await inputs.nth(2).fill('07700900123');
    await page.getByTestId('org-create-submit').click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 23 entries');
    expect(st.created.map(c => c.op)).toEqual(['createReferringOrganisation']);
  });

  test('referee index: 10 per page, Updated desc, organisation column sorts by its nested key', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/referring-organisation-contacts');
    const W = '#referring-org-contact-index_wrapper';
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 11 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    expect(lastReferees(st)).toMatchObject({ page: { size: 10, page: 0, sort: [{ key: 'updatedAt', value: 'desc' }] }, filter: { archived: { _in: [false] } } });
    const th = page.locator('#referring-org-contact-index thead th');
    await expect(th.nth(7)).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('#referring-org-contact-index tbody tr').first()).toContainText('Referee 11');

    await th.nth(5).click();
    await expect(th.nth(5)).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => lastReferees(st).page!.sort).toEqual([{ key: 'referringOrganisation.name', value: 'asc' }]);
    await th.nth(5).click();
    await expect(th.nth(5)).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => lastReferees(st).page!.sort).toEqual([{ key: 'referringOrganisation.name', value: 'desc' }]);
    // The organisation cell links to the organisation.
    await expect(page.locator('#referring-org-contact-index tbody tr').first().locator('td').nth(5).locator('a')).toHaveAttribute('href', /referring-organisations\/2$/);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 11 of 11 entries');
    const box = page.locator(`${W} .dt-search input`);
    await box.fill('Referee 05');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 1 of 1 entry (filtered from 11 total entries)');
  });

  test('organisation referees tab: 5 per page, sends the organisation where, create reloads', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/referring-organisations/1');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Referees' }).click();
    const T = '#referring-organisation-referees-1';
    const W = `${T}_wrapper`;
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 11 entries');
    await expect(page.locator(`${T} tbody tr`)).toHaveCount(5);
    expect(lastReferees(st, true)).toMatchObject({
      page: { size: 5, page: 0, sort: [{ key: 'updatedAt', value: 'desc' }] },
      where: { referringOrganisation: { id: { _eq: 1 } } },
    });
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 10 of 11 entries');

    await page.getByTestId('contact-create-open').click();
    const inputs = page.locator('.modal-body input');
    await inputs.nth(0).fill('Zed Newcomer');
    await inputs.nth(1).fill('zed@example.org');
    await inputs.nth(2).fill('07700900124');
    await inputs.nth(3).fill('1 Test Street, London');
    await inputs.nth(3).blur();
    await page.getByRole('button', { name: 'CREATE' }).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 10 of 12 entries');
    expect(st.created.map(c => c.op)).toEqual(['createReferringOrganisationContact']);
    expect(st.created[0].data.referringOrganisation).toBe(1);
  });
});
