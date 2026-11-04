/**
 * Distributions and Deliveries (DnD) device-request table - filtering, pagination, counts.
 *
 * WHY THIS EXISTS
 *   Product note: "DnD table filtering, pagination, counts all need a fair bit of tidying up as
 *   it's currently a bit confusing". This spec PINS the behaviour before anyone tidies it: the
 *   obviously-correct assertions are written as ordinary tests, and where the current app
 *   violates one the test is kept but marked `test.fail()` with a `// DEFECT:` line, so the
 *   suite stays green today and a fixed defect flips the test red ("expected to fail but
 *   passed") - at which point delete the `test.fail()` line.
 *
 *   Component: src/app/views/corewidgets/components/distributions-and-deliveries-index/
 *
 * HOW
 *   A stateful GraphQL stub answers `findAllDeviceRequests` by actually HONOURING the variables
 *   (`filter`, `term`/`numericterm`, `page.page`, `page.size`, `page.sort`) over a 63-row fixture
 *   (54 non-commercial, 9 commercial), so a default page-size of 10 spans six pages. Every
 *   request's variables are recorded so tests can assert on exactly what each control sent.
 *   Expected rows/totals are derived from the FIXTURE with independent in-test predicates, never
 *   from the stub's own answer.
 *
 * WHAT DRIVES WHAT (as read from the component)
 *   - Search box (DataTables' own, as-you-type, 400ms throttle) -> `term` + `numericterm`.
 *   - Page size select -> `page.size`; pager -> `page.page` (0-based) = round(start/length).
 *   - Column header click -> `page.sort[{key,value}]` (default id desc).
 *   - Filter modal / quick buttons -> `filter` (status/isSales/deviceRequestItems/isPrepped/
 *     collectionMethod + AND[collectionDate _gte/_lte]). Persisted in localStorage under
 *     `distributionsAndDeliveriesFilters-<tableId>`; DataTables state is persisted too
 *     (stateSave) under `DataTables_<tableId>_<path>`.
 *   - Every count: DataTables info line + pager page numbers <- `totalElements`; Filter badge <-
 *     client-side `filterCount` (number of ticked OPTIONS, not number of constraints); per-row
 *     "allocated / requested" badges <- `kits[]` vs `deviceRequestItems`.
 *
 * Tests that need a live API (real sort keys, real filter semantics, real week boundaries) are
 * listed at the bottom of the file as a comment, not here.
 *
 * @mocked - every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith as seedAuth0Cache } from '../helpers/auth0-cache';

const PATH = '/dashboard/distributions-and-deliveries';
const TABLE_ID = 'distributions-and-deliveries-index';
const FILTER_KEY = `distributionsAndDeliveriesFilters-${TABLE_ID}`;
const DT_STATE_KEY = `DataTables_${TABLE_ID}_${PATH}`;

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

const STATUSES = [
  'NEW',
  'PROCESSING_EQUALITIES_DATA_COMPLETE',
  'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
  'PROCESSING_ON_HOLD',
  'REQUEST_COMPLETED',
  'REQUEST_COLLECTION_DELIVERY_FAILED',
  'REQUEST_DECLINED',
  'REQUEST_CANCELLED',
];

/** Same algorithm as generateWeekButtons(), so fixture dates land inside the buttons' ranges. */
function weekRange(i: number): { start: Date; end: Date } {
  const today = new Date();
  const diff = today.getDay() === 0 ? -6 : 1 - today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const start = new Date(monday);
  start.setDate(monday.getDate() + i * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function midWeek(i: number): string {
  const { start } = weekRange(i);
  const d = new Date(start);
  d.setDate(start.getDate() + 2);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

interface Meta {
  isSales: boolean;
}
interface Row {
  id: number;
  status: string;
  clientRef: string;
  collectionDate: string | null;
  deviceRequestItems: Record<string, number>;
  kits: { id: number; type: string }[];
  referringOrganisationContact: { id: number; fullName: string; referringOrganisation: { id: number; name: string } };
  isPrepped: boolean;
  collectionMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

const TOTAL_ROWS = 63;

function buildFixture(): { rows: Row[]; meta: Map<number, Meta> } {
  const rows: Row[] = [];
  const meta = new Map<number, Meta>();
  for (let i = 1; i <= TOTAL_ROWS; i++) {
    const wk = i % 6;
    const day = String(((i - 1) % 28) + 1).padStart(2, '0');
    rows.push({
      id: i,
      status: STATUSES[i % 8],
      clientRef: `CR-${String(i).padStart(3, '0')}`,
      // i%6: 0..3 -> in quick-button week 0..3, 4 -> long ago, 5 -> unscheduled.
      collectionDate: wk <= 3 ? midWeek(wk) : wk === 4 ? '2020-03-04T12:00:00Z' : null,
      deviceRequestItems: {
        phones: i % 5 === 0 ? 2 : 0,
        tablets: 0,
        laptops: i % 4 === 0 ? 3 : 0,
        allInOnes: 0,
        desktops: i % 9 === 0 ? 1 : 0,
        commsDevices: 0,
        other: 0,
      },
      kits: [],
      referringOrganisationContact: {
        id: 1000 + i,
        fullName: `Referee ${i % 9}`,
        referringOrganisation: { id: 2000 + i, name: i % 11 === 0 ? 'Zebra Aid' : `Org ${i % 5}` },
      },
      isPrepped: i % 3 === 0,
      collectionMethod: i % 10 === 0 ? null : i % 2 === 0 ? 'DELIVERY' : 'COLLECTION',
      createdAt: `2026-01-${day}T10:00:00Z`,
      updatedAt: `2026-02-${day}T10:00:00Z`,
    });
    meta.set(i, { isSales: i % 7 === 0 });
  }
  // Row 8: asked for 3 laptops (i%4==0 -> laptops 3), 2 laptop kits + 1 smartphone allocated.
  rows[7].kits = [
    { id: 9001, type: 'LAPTOP' },
    { id: 9002, type: 'LAPTOP' },
    { id: 9003, type: 'SMARTPHONE' },
  ];
  // Row 20: 3 laptops, 1 phone requested (i%4==0, i%5==0 -> laptops 3, phones 2), one OTHER kit.
  rows[19].kits = [{ id: 9010, type: 'OTHER' }];
  return { rows, meta };
}

const FIX = buildFixture();

const nonSales = (r: Row) => !FIX.meta.get(r.id)!.isSales;
const byIdDesc = (a: Row, b: Row) => b.id - a.id;
const ids = (rows: Row[]) => rows.map((r) => r.id);

// ---------------------------------------------------------------------------------------------
// GraphQL stub that honours the variables
// ---------------------------------------------------------------------------------------------

interface Vars {
  page?: { page: number; size: number; sort: { key: string; value: string }[] };
  term?: string;
  numericterm?: number;
  filter?: any;
}

function pathGet(o: any, path: string): any {
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
}

function matchesFilter(r: Row, f: any): boolean {
  if (!f) return true;
  if (f.status && !f.status._in.includes(r.status)) return false;
  if (f.isSales && !f.isSales._in.includes(FIX.meta.get(r.id)!.isSales)) return false;
  if (f.isPrepped && !f.isPrepped._in.includes(r.isPrepped)) return false;
  if (f.collectionMethod && !f.collectionMethod._in.includes(r.collectionMethod)) return false;
  if (f.deviceRequestItems) {
    for (const [k, cond] of Object.entries<any>(f.deviceRequestItems)) {
      if (!((r.deviceRequestItems[k] ?? 0) > cond._gt)) return false;
    }
  }
  for (const clause of f.AND ?? []) {
    const cd = clause.collectionDate;
    if (!cd) continue;
    if (!r.collectionDate) return false;
    const t = Date.parse(r.collectionDate);
    if (cd._gte && !(t >= Date.parse(cd._gte))) return false;
    if (cd._lte && !(t <= Date.parse(cd._lte))) return false;
  }
  return true;
}

function matchesTerm(r: Row, term: string, numeric: number): boolean {
  const t = (term ?? '').toLowerCase();
  return (
    r.clientRef.toLowerCase().includes(t) ||
    r.id === numeric ||
    r.referringOrganisationContact.referringOrganisation.name.toLowerCase().includes(t) ||
    r.referringOrganisationContact.fullName.toLowerCase().includes(t)
  );
}

function answer(v: Vars): { totalElements: number; content: Row[] } {
  const matched = FIX.rows.filter(
    (r) => matchesFilter(r, v.filter) && matchesTerm(r, v.term ?? '', v.numericterm ?? -1),
  );
  for (const s of (v.page?.sort ?? []).slice().reverse()) {
    const dir = s.value === 'desc' ? -1 : 1;
    matched.sort((a, b) => {
      const x = pathGet(a, s.key);
      const y = pathGet(b, s.key);
      return (x == null ? -Infinity : x) < (y == null ? -Infinity : y) ? -dir : x === y ? 0 : dir;
    });
  }
  const size = v.page?.size ?? 10;
  const from = (v.page?.page ?? 0) * size;
  return { totalElements: matched.length, content: matched.slice(from, from + size) };
}

interface Harness {
  /** Variables of every findAllDeviceRequests request, oldest first. */
  reqs: Vars[];
  last(): Vars;
  /** Run an action and resolve with the variables of the first NEW request it caused. */
  after(action: () => Promise<unknown>): Promise<Vars>;
  /** Reject the next N requests with a GraphQL error instead of data. */
  failNext(n: number): void;
  /** Hold every response until released (to observe in-flight state). */
  hold(): { release: () => void };
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup(page: Page, opts: { localStorage?: Record<string, string> } = {}): Promise<Harness> {
  await seedAuth0Cache(page, [], { subject: 'auth0|e2e-dnd-table', localStorage: opts.localStorage });
  const reqs: Vars[] = [];
  let failures = 0;
  let gate: Promise<void> | null = null;
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('findAllDeviceRequests')) {
      const vars: Vars = JSON.parse(body).variables ?? {};
      reqs.push(vars);
      if (gate) await gate;
      if (failures > 0) {
        failures--;
        return fulfillJson(route, { errors: [{ message: 'DnD stub failure' }], data: null });
      }
      return fulfillJson(route, { data: { deviceRequestConnection: answer(vars) } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    if (body.includes('featureFlagsPublic')) return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    return fulfillJson(route, { data: {} });
  });
  return {
    reqs,
    last: () => reqs[reqs.length - 1],
    after: async (action) => {
      const before = reqs.length;
      await action();
      await expect.poll(() => reqs.length, { timeout: 15_000 }).toBeGreaterThan(before);
      return reqs[before];
    },
    failNext: (n) => {
      failures = n;
    },
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return {
        release: () => {
          gate = null;
          release();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------------

const table = (page: Page) => page.locator(`#${TABLE_ID}`);
const dataRows = (page: Page) => table(page).locator('tbody tr:has(td a[href])');
const info = (page: Page) => page.locator(`#${TABLE_ID}_info`);
const pager = (page: Page) => page.getByRole('navigation', { name: 'pagination' });
const searchBox = (page: Page) => page.locator(`input[aria-controls="${TABLE_ID}"]`);
const lengthSelect = (page: Page) => page.getByRole('combobox', { name: 'entries per page' });
const filterButton = (page: Page) => page.locator('a.btn-info', { hasText: 'Filter' });
const filterBadge = (page: Page) => filterButton(page).locator('.badge');
const quickBar = (page: Page) => page.locator('div.mt-3.px-3.d-flex');
const weekButtons = (page: Page) => quickBar(page).locator('button.btn-primary, button.btn-outline-primary');
const failedButton = (page: Page) => quickBar(page).getByRole('button', { name: 'Collection/Delivery Failed' });
const clearButton = (page: Page) => quickBar(page).getByRole('button', { name: 'Clear' });

async function shownIds(page: Page): Promise<number[]> {
  const texts = await dataRows(page).locator('td:first-child').allInnerTexts();
  return texts.map((t) => Number(t.trim()));
}

/** Waits until the table shows exactly these ids, in this order. */
async function expectIds(page: Page, expected: number[]): Promise<void> {
  await expect.poll(() => shownIds(page), { timeout: 15_000 }).toEqual(expected);
}

async function expectInfo(page: Page, from: number, to: number, total: number): Promise<void> {
  await expect(info(page)).toHaveText(`Showing ${from} to ${to} of ${total} ${total === 1 ? 'entry' : 'entries'}`, { timeout: 15_000 });
}

async function load(page: Page, h: Harness): Promise<void> {
  await page.goto(PATH);
  await expect(dataRows(page).first()).toBeVisible({ timeout: 30_000 });
  // The component fires an initial draw and then a filtered reload from ngAfterViewInit;
  // wait until the default (non-commercial) view has settled.
  await expectInfo(page, 1, 10, FIX.rows.filter(nonSales).length);
  await expect.poll(() => h.reqs.length).toBeGreaterThan(0);
}

async function openFilter(page: Page): Promise<void> {
  await filterButton(page).click();
  await expect(page.locator('.modal-title', { hasText: 'Distributions And Deliveries Filters' })).toBeVisible();
}

const modalBody = (page: Page) => page.locator('.modal-body');

async function submitFilter(page: Page): Promise<void> {
  await page.locator('.modal-footer button.btn-primary', { hasText: 'Filter' }).click();
  await expect(page.locator('.modal-title')).toHaveCount(0);
}

async function tick(page: Page, label: string): Promise<void> {
  await modalBody(page).getByLabel(label, { exact: true }).check();
}
async function untick(page: Page, label: string): Promise<void> {
  await modalBody(page).getByLabel(label, { exact: true }).uncheck();
}

async function pickStatuses(page: Page, labels: string[]): Promise<void> {
  const select = modalBody(page).locator('label', { hasText: 'Status of the request' }).locator('xpath=..').locator('ng-select');
  const panel = page.locator('.ng-dropdown-panel');
  // ng-select closes after each pick (closeOnSelect), so reopen for every option.
  for (const l of labels) {
    await select.click();
    await panel.getByText(l, { exact: true }).click();
  }
  await page.locator('.modal-title').click(); // not Escape: it reverts the selection (see ng-select spec)
  await expect(panel).toBeHidden();
}

async function goToPage(page: Page, label: string | number): Promise<void> {
  await pager(page).getByRole('link', { name: String(label), exact: true }).click();
}

/** Applies a modal filter in one go, returning the request it caused. */
async function applyModal(page: Page, h: Harness, fill: () => Promise<void>): Promise<Vars> {
  await openFilter(page);
  await fill();
  return h.after(() => submitFilter(page));
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test.describe('DnD table: initial load @mocked', () => {
  test('loads page 1, newest first, non-commercial only, with consistent totals', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);

    const expected = FIX.rows.filter(nonSales).sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, 1, 10, 54);
    await expect(lengthSelect(page)).toHaveValue('10');
    // 54 rows / 10 per page = 6 pages.
    await expect(pager(page).getByRole('link', { name: '6', exact: true })).toBeVisible();
    await expect(pager(page).getByRole('link', { name: '7', exact: true })).toHaveCount(0);

    const v = h.last();
    expect(v.page).toEqual({ page: 0, size: 10, sort: [{ key: 'id', value: 'desc' }] });
    expect(v.term).toBe('');
    expect(v.filter.isSales).toEqual({ _in: [false] });
  });

  test('the Filter badge says 1 for the default non-commercial filter', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await expect(filterBadge(page)).toHaveText('1');
  });

  test('the first request sent already carries the default filter', async ({ page }) => {
    // DEFECT: DataTables' own initial draw fires before ngAfterViewInit applies the saved/default
    // filter, so the first findAllDeviceRequests is UNFILTERED (filter {}, i.e. commercial rows
    // too) and a second, filtered, request follows. Double fetch + a flash of the wrong rows.
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    expect(h.reqs[0].filter?.isSales).toEqual({ _in: [false] });
  });

  test('only one request is made on initial load', async ({ page }) => {
    // DEFECT: initial load issues two requests (unfiltered draw + filtered reload); see above.
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await page.waitForTimeout(1_000);
    expect(h.reqs.length).toBe(1);
  });
});

test.describe('DnD table: pagination @mocked', () => {
  test('next / previous / numbered / last page request the right 0-based page and show the right rows', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    const expected = FIX.rows.filter(nonSales).sort(byIdDesc);

    let v = await h.after(() => pager(page).getByRole('link', { name: 'Next' }).click());
    expect(v.page!.page).toBe(1);
    await expectIds(page, ids(expected.slice(10, 20)));
    await expectInfo(page, 11, 20, 54);

    v = await h.after(() => goToPage(page, 4));
    expect(v.page!.page).toBe(3);
    await expectIds(page, ids(expected.slice(30, 40)));
    await expectInfo(page, 31, 40, 54);

    v = await h.after(() => pager(page).getByRole('link', { name: 'Previous' }).click());
    expect(v.page!.page).toBe(2);
    await expectIds(page, ids(expected.slice(20, 30)));

    v = await h.after(() => goToPage(page, 6));
    expect(v.page!.page).toBe(5);
    // Last page is partial: 54 = 5*10 + 4.
    await expectIds(page, ids(expected.slice(50, 54)));
    await expectInfo(page, 51, 54, 54);
    await expect(pager(page).getByRole('link', { name: 'Next' })).toBeDisabled();
  });

  test('Previous is disabled and Next enabled on page 1', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await expect(pager(page).getByRole('link', { name: 'Previous' })).toBeDisabled();
    await expect(pager(page).getByRole('link', { name: 'Next' })).toBeEnabled();
  });

  test('changing page size sends page.size, resets to page 1 and recomputes the page count', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    const expected = FIX.rows.filter(nonSales).sort(byIdDesc);

    await h.after(() => goToPage(page, 3));
    await expectInfo(page, 21, 30, 54);

    const v = await h.after(() => lengthSelect(page).selectOption('25'));
    expect(v.page).toMatchObject({ size: 25, page: 0 });
    await expectIds(page, ids(expected.slice(0, 25)));
    await expectInfo(page, 1, 25, 54);
    // 54 / 25 = 3 pages.
    await expect(pager(page).getByRole('link', { name: '3', exact: true })).toBeVisible();
    await expect(pager(page).getByRole('link', { name: '4', exact: true })).toHaveCount(0);

    const v2 = await h.after(() => lengthSelect(page).selectOption('100'));
    expect(v2.page).toMatchObject({ size: 100, page: 0 });
    await expectIds(page, ids(expected));
    await expectInfo(page, 1, 54, 54);

    const v3 = await h.after(() => lengthSelect(page).selectOption('5'));
    expect(v3.page).toMatchObject({ size: 5, page: 0 });
    await expectInfo(page, 1, 5, 54);
    await expect(pager(page).getByRole('link', { name: '11', exact: true })).toBeVisible(); // ceil(54/5)
  });

  test('the page size offers 5/10/25/50/100', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await expect(lengthSelect(page).locator('option')).toHaveText(['5', '10', '25', '50', '100']);
  });

  test('changing page size while on page 3 returns to page 1 (never an offset into the new size)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => goToPage(page, 3)); // start = 20
    const v = await h.after(() => lengthSelect(page).selectOption('25'));
    expect(v.page!.page).toBe(0);
  });
});

test.describe('DnD table: search @mocked', () => {
  test('typing searches as-you-type (no Enter needed): term + numericterm sent, total and rows follow', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);

    const v = await h.after(() => searchBox(page).fill('CR-017'));
    expect(v.term).toBe('CR-017');
    expect(v.numericterm).toBe(-1);
    await expectIds(page, [17]);
    await expectInfo(page, 1, 1, 1);
  });

  test('pressing Enter does not send a second, duplicate request', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('CR-017'));
    await expectIds(page, [17]);
    const n = h.reqs.length;
    await searchBox(page).press('Enter');
    await page.waitForTimeout(1_000);
    expect(h.reqs.length).toBe(n);
  });

  test('a numeric term also matches the record id', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => searchBox(page).fill('41'));
    expect(v.numericterm).toBe(41);
    // id 41 (non-sales: 41 % 7 != 0) plus any clientRef containing "41".
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => r.id === 41 || r.clientRef.includes('41') || /41/.test(r.referringOrganisationContact.fullName))
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
  });

  test('searches by organisation name and referee name', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);

    await h.after(() => searchBox(page).fill('zebra'));
    const zebra = FIX.rows.filter(nonSales).filter((r) => r.referringOrganisationContact.referringOrganisation.name === 'Zebra Aid');
    await expectIds(page, ids(zebra.sort(byIdDesc).slice(0, 10)));
    await expectInfo(page, 1, zebra.length, zebra.length);

    await h.after(() => searchBox(page).fill('Referee 3'));
    const ref3 = FIX.rows.filter(nonSales).filter((r) => r.referringOrganisationContact.fullName === 'Referee 3').sort(byIdDesc);
    await expectIds(page, ids(ref3.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, ref3.length), ref3.length);
  });

  test('search combines with the active filter (AND, not replace)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    const v = await h.after(() => searchBox(page).fill('Zebra'));
    expect(v.filter.isPrepped).toEqual({ _in: [true] });
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => r.isPrepped && r.referringOrganisationContact.referringOrganisation.name === 'Zebra Aid')
      .sort(byIdDesc);
    await expectIds(page, ids(expected));
    await expectInfo(page, 1, expected.length, expected.length);
  });

  test('searching from page 3 returns to page 1 of the results', async ({ page }) => {
    // (DataTables resets `start` on a new search by itself, so the reload(null, false) in the component
    // is harmless for search - unlike applyFilter, which has to pass resetPaging=true explicitly.)
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => goToPage(page, 3));
    const v = await h.after(() => searchBox(page).fill('Org 1'));
    expect(v.page!.page).toBe(0);
  });

  test('a search or filter with no matches says "No matching records", not "No data available"', async ({ page }) => {
    // DEFECT: the ajax callback reports recordsTotal === recordsFiltered === totalElements, so with zero
    // matches DataTables picks its emptyTable text ("No data available in table"), which reads as "the
    // database is empty", instead of zeroRecords ("No matching records found"). Fix: report the unfiltered
    // total (or set language.emptyTable to the zeroRecords wording).
    // component: distributions-and-deliveries-index.component.ts:522-523
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('nothing-matches-this'));
    await expectIds(page, []);
    await expect(table(page)).toContainText('No matching records found');
  });

  test('clearing the search restores the full list', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('CR-017'));
    await expectIds(page, [17]);
    const v = await h.after(() => searchBox(page).fill(''));
    expect(v.term).toBe('');
    await expectInfo(page, 1, 10, 54);
  });

  test('a search with no matches shows the empty state with zero totals', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('nothing-matches-this'));
    await expectIds(page, []);
    await expectInfo(page, 0, 0, 0);
    await expect(table(page)).toContainText('No data available in table');
  });
});

test.describe('DnD table: modal filters @mocked', () => {
  test('status filter: _in sent, rows + total + badge follow', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await applyModal(page, h, () => pickStatuses(page, ['New request', 'On hold']));
    expect(v.filter.status._in.slice().sort()).toEqual(['NEW', 'PROCESSING_ON_HOLD']);
    expect(v.filter.isSales).toEqual({ _in: [false] });
    const expected = FIX.rows.filter(nonSales).filter((r) => ['NEW', 'PROCESSING_ON_HOLD'].includes(r.status)).sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, expected.length), expected.length);
    await expect(filterBadge(page)).toHaveText('3'); // 2 statuses + the default non-commercial
  });

  test('commercial filter: Commercial alone, then both, send the right isSales _in', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);

    let v = await applyModal(page, h, async () => {
      await untick(page, 'Non-commercial');
      await tick(page, 'Commercial');
    });
    expect(v.filter.isSales).toEqual({ _in: [true] });
    const sales = FIX.rows.filter((r) => FIX.meta.get(r.id)!.isSales).sort(byIdDesc);
    await expectIds(page, ids(sales));
    await expectInfo(page, 1, sales.length, sales.length);

    v = await applyModal(page, h, () => tick(page, 'Non-commercial'));
    expect(v.filter.isSales._in.slice().sort()).toEqual([false, true]);
    await expectInfo(page, 1, 10, TOTAL_ROWS);
  });

  test('with both commercial options ticked the Filter badge does not claim 2 active filters', async ({ page }) => {
    // DEFECT: filterCount adds one per ticked OPTION, so Commercial + Non-commercial (which
    // together constrain nothing) shows a badge of 2, and even the untouched default shows 1.
    // The badge reads as "N filters active" but means "N boxes ticked".
    // component: distributions-and-deliveries-index.component.ts:369-372
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Commercial'));
    await expectInfo(page, 1, 10, TOTAL_ROWS);
    await expect(filterBadge(page)).toHaveCount(0);
  });

  test('device-type filter sends a _gt:0 constraint per type', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await applyModal(page, h, () => tick(page, 'Laptops'));
    expect(v.filter.deviceRequestItems).toEqual({ laptops: { _gt: 0 } });
    const expected = FIX.rows.filter(nonSales).filter((r) => r.deviceRequestItems.laptops > 0).sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, expected.length), expected.length);
    await expect(filterBadge(page)).toHaveText('2');
  });

  test('ticking two device types returns requests that want EITHER type', async ({ page }) => {
    // DEFECT: the types are ANDed (deviceRequestItems {laptops:{_gt:0}, phones:{_gt:0}}), so
    // ticking Laptops + Phones returns only requests asking for BOTH. Every other multi-tick
    // control in this modal (status, sales, prepped, method) is an OR/_in; this one silently
    // narrows instead of widening, which is exactly the "confusing filter" complaint.
    // component: distributions-and-deliveries-index.component.ts:374-384
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, async () => {
      await tick(page, 'Laptops');
      await tick(page, 'Phones');
    });
    const either = FIX.rows.filter(nonSales).filter((r) => r.deviceRequestItems.laptops > 0 || r.deviceRequestItems.phones > 0);
    await expectInfo(page, 1, Math.min(10, either.length), either.length);
  });

  test('prepped filter: Prepped, Not Prepped, both', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    let v = await applyModal(page, h, () => tick(page, 'Prepped'));
    expect(v.filter.isPrepped).toEqual({ _in: [true] });
    const prepped = FIX.rows.filter(nonSales).filter((r) => r.isPrepped);
    await expectInfo(page, 1, Math.min(10, prepped.length), prepped.length);

    v = await applyModal(page, h, async () => {
      await untick(page, 'Prepped');
      await tick(page, 'Not Prepped');
    });
    expect(v.filter.isPrepped).toEqual({ _in: [false] });
    const notPrepped = FIX.rows.filter(nonSales).filter((r) => !r.isPrepped);
    await expectInfo(page, 1, 10, notPrepped.length);
    // Visible check-boxes agree with the filter.
    const boxes = await dataRows(page).locator('input[type=checkbox]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
    expect(boxes.every((b) => b === false)).toBe(true);
  });

  test('collection/delivery filter: Collection, Delivery, both', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    let v = await applyModal(page, h, () => tick(page, 'Delivery'));
    expect(v.filter.collectionMethod).toEqual({ _in: ['DELIVERY'] });
    const delivery = FIX.rows.filter(nonSales).filter((r) => r.collectionMethod === 'DELIVERY');
    await expectInfo(page, 1, Math.min(10, delivery.length), delivery.length);
    const cells = await dataRows(page).locator('td:nth-child(6)').allInnerTexts();
    expect(cells.map((c) => c.trim()).every((c) => c === 'Delivery')).toBe(true);

    v = await applyModal(page, h, async () => {
      await untick(page, 'Delivery');
      await tick(page, 'Collection');
    });
    expect(v.filter.collectionMethod).toEqual({ _in: ['COLLECTION'] });
    const collection = FIX.rows.filter(nonSales).filter((r) => r.collectionMethod === 'COLLECTION');
    await expectInfo(page, 1, 10, collection.length);
  });

  test('all modal filters combine (AND across controls) and the totals agree', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await applyModal(page, h, async () => {
      await pickStatuses(page, ['New request', 'Completed', 'Declined']);
      await tick(page, 'Prepped');
      await tick(page, 'Delivery');
    });
    expect(v.filter).toMatchObject({
      status: { _in: expect.arrayContaining(['NEW', 'REQUEST_COMPLETED', 'REQUEST_DECLINED']) },
      isSales: { _in: [false] },
      isPrepped: { _in: [true] },
      collectionMethod: { _in: ['DELIVERY'] },
    });
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => ['NEW', 'REQUEST_COMPLETED', 'REQUEST_DECLINED'].includes(r.status) && r.isPrepped && r.collectionMethod === 'DELIVERY')
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, expected.length ? 1 : 0, Math.min(10, expected.length), expected.length);
    // 3 statuses + non-commercial + prepped + delivery
    await expect(filterBadge(page)).toHaveText('6');
  });

  test('a filter that matches nothing shows the empty state, zero total and no pager pages', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    // Commercial-only AND status Cancelled AND Prepped AND Delivery: choose a combination the fixture lacks.
    await applyModal(page, h, async () => {
      await pickStatuses(page, ['Cancelled']);
      await tick(page, 'Desktops');
      await tick(page, 'Laptops');
      await tick(page, 'Phones');
    });
    const expected = FIX.rows.filter(nonSales).filter(
      (r) => r.status === 'REQUEST_CANCELLED' && r.deviceRequestItems.desktops > 0 && r.deviceRequestItems.laptops > 0 && r.deviceRequestItems.phones > 0,
    );
    expect(expected.length).toBe(0);
    await expectIds(page, []);
    await expectInfo(page, 0, 0, 0);
    await expect(table(page)).toContainText('No data available in table');
  });

  test('applying a filter while on page 3 returns to page 1', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => goToPage(page, 3));
    await expectInfo(page, 21, 30, 54);
    const v = await applyModal(page, h, () => tick(page, 'Prepped'));
    expect(v.page!.page).toBe(0);
    const prepped = FIX.rows.filter(nonSales).filter((r) => r.isPrepped).sort(byIdDesc);
    await expectIds(page, ids(prepped.slice(0, 10)));
    await expectInfo(page, 1, 10, prepped.length);
  });

  test('the filter modal re-opens showing the filters currently applied', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await openFilter(page);
    await expect(modalBody(page).getByLabel('Prepped', { exact: true })).toBeChecked();
    await expect(modalBody(page).getByLabel('Non-commercial', { exact: true })).toBeChecked();
    await expect(modalBody(page).getByLabel('Commercial', { exact: true })).not.toBeChecked();
  });

  test('cancelling the modal changes nothing and sends no request', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const n = h.reqs.length;
    await openFilter(page);
    await tick(page, 'Prepped');
    await page.locator('.modal-footer button', { hasText: 'CANCEL' }).click();
    await page.waitForTimeout(500);
    expect(h.reqs.length).toBe(n);
    await expect(filterBadge(page)).toHaveText('1');
  });

  test('there is a way to clear every filter in one click', async ({ page }) => {
    // DEFECT: the modal has no Reset/Clear-all, and the page "Clear" button only appears after a
    // quick filter and clears just date + status (not sales/prepped/device/method). To get back to
    // an unfiltered list a user must untick every box by hand - and the "no filter" state is not
    // even reachable: the default non-commercial filter has no off switch other than ticking both.
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await openFilter(page);
    await expect(page.locator('.modal-footer').getByRole('button', { name: /clear|reset/i })).toBeVisible({ timeout: 2_000 });
  });

  test('un-ticking everything in a filter group drops that constraint from the request', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    const v = await applyModal(page, h, async () => {
      await untick(page, 'Prepped');
      await untick(page, 'Non-commercial');
    });
    expect(v.filter.isPrepped).toBeUndefined();
    expect(v.filter.isSales).toBeUndefined();
    await expectInfo(page, 1, 10, TOTAL_ROWS);
    await expect(filterBadge(page)).toHaveCount(0);
  });
});

test.describe('DnD table: quick filter buttons @mocked', () => {
  test('there are four week buttons (this week + 3) and a Failed status button', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await expect(weekButtons(page)).toHaveCount(4);
    await expect(failedButton(page)).toBeVisible();
    await expect(clearButton(page)).toHaveCount(0);
    const labels = (await weekButtons(page).allInnerTexts()).map((t) => t.trim());
    const expected = [0, 1, 2, 3].map((i) => weekRange(i).start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    expect(labels).toEqual(expected);
  });

  test('a week button sends the Mon-Sun collectionDate range, highlights, shows Clear and counts +2', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => weekButtons(page).nth(1).click());
    const { start, end } = weekRange(1);
    expect(v.filter.AND).toEqual([
      { collectionDate: { _gte: start.toISOString() } },
      { collectionDate: { _lte: end.toISOString() } },
    ]);
    expect(v.page!.page).toBe(0);
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    await expect(clearButton(page)).toBeVisible();
    const inWeek = FIX.rows.filter(nonSales).filter((r) => r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end).sort(byIdDesc);
    await expectIds(page, ids(inWeek.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, inWeek.length), inWeek.length);
    await expect(filterBadge(page)).toHaveText('3'); // non-commercial + start + end
  });

  test('picking a second week replaces the first (only one highlighted)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await h.after(() => weekButtons(page).nth(2).click());
    const { start } = weekRange(2);
    expect(v.filter.AND[0]).toEqual({ collectionDate: { _gte: start.toISOString() } });
    await expect(quickBar(page).locator('button.btn-primary')).toHaveCount(1);
  });

  test('a week button from page 3 returns to page 1', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => goToPage(page, 3));
    const v = await h.after(() => weekButtons(page).nth(0).click());
    expect(v.page!.page).toBe(0);
  });

  test('the Failed button filters to REQUEST_COLLECTION_DELIVERY_FAILED and highlights green', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => failedButton(page).click());
    expect(v.filter.status).toEqual({ _in: ['REQUEST_COLLECTION_DELIVERY_FAILED'] });
    await expect(failedButton(page)).toHaveClass(/btn-success/);
    const failed = FIX.rows.filter(nonSales).filter((r) => r.status === 'REQUEST_COLLECTION_DELIVERY_FAILED').sort(byIdDesc);
    await expectIds(page, ids(failed.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, failed.length), failed.length);
    await expect(filterBadge(page)).toHaveText('2');
  });

  test('Clear removes the quick filter, un-highlights, hides Clear and restores the total', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await h.after(() => clearButton(page).click());
    expect(v.filter.AND).toEqual([]);
    expect(v.filter.status).toBeUndefined();
    await expect(clearButton(page)).toHaveCount(0);
    await expectInfo(page, 1, 10, 54);
    await expect(filterBadge(page)).toHaveText('1');
  });

  test('the Failed button respects the other modal filters (AND) and the total agrees', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Delivery'));
    const v = await h.after(() => failedButton(page).click());
    expect(v.filter.collectionMethod).toEqual({ _in: ['DELIVERY'] });
    expect(v.filter.status).toEqual({ _in: ['REQUEST_COLLECTION_DELIVERY_FAILED'] });
    const expected = FIX.rows.filter(nonSales).filter((r) => r.status === 'REQUEST_COLLECTION_DELIVERY_FAILED' && r.collectionMethod === 'DELIVERY');
    await expectInfo(page, expected.length ? 1 : 0, Math.min(10, expected.length), expected.length);
  });

  test('week and status quick filters stack, and both show as active', async ({ page }) => {
    // DEFECT: week and Failed are presented as one row of mutually exclusive-looking buttons
    // (a single `activeFilter`), but clicking a week then Failed sends BOTH constraints while
    // highlighting only Failed - the week button goes back to outline although its date range
    // is still applied. The table is silently narrower than the buttons say.
    // component: distributions-and-deliveries-index.component.ts:332-340 (activeFilter is one string)
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await h.after(() => failedButton(page).click());
    expect(v.filter.AND.length).toBe(2); // the week range is still being applied...
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/); // ...so it must still look active
  });

  test('a week button after the Failed button drops the status filter silently', async ({ page }) => {
    // DEFECT: applyWeekFilter deletes `status` from the filter, including statuses the user chose in
    // the modal. Picking a week therefore throws away "Status of the request" with no hint.
    // component: distributions-and-deliveries-index.component.ts:327
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => pickStatuses(page, ['On hold']));
    const v = await h.after(() => weekButtons(page).nth(0).click());
    expect(v.filter.status).toEqual({ _in: ['PROCESSING_ON_HOLD'] });
  });

  test('Clear leaves modal-chosen statuses alone', async ({ page }) => {
    // DEFECT: clearQuickFilters deletes `status` unconditionally, so "Clear" after a week click also
    // wipes a status the user picked in the modal beforehand.
    // component: distributions-and-deliveries-index.component.ts:347
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => pickStatuses(page, ['On hold']));
    await h.after(() => weekButtons(page).nth(0).click()); // (already drops status - see above)
    const v = await h.after(() => clearButton(page).click());
    expect(v.filter.status).toEqual({ _in: ['PROCESSING_ON_HOLD'] });
  });

  test('submitting the filter modal after a week button keeps the week range', async ({ page }) => {
    // DEFECT: the modal form has no date fields, so its submit data lacks collectionDateStart/End;
    // applyFilter then saves/sends a filter WITHOUT the week range, yet `activeFilter` still
    // highlights the week button and shows Clear. UI says "week X", data is unfiltered by date.
    // component: distributions-and-deliveries-index.component.ts:354-357 + 270
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await applyModal(page, h, () => tick(page, 'Prepped'));
    expect(v.filter.AND?.length).toBe(2);
  });

  test('the week button highlight always agrees with whether a date range is being sent', async ({ page }) => {
    // DEFECT: companion to the above - after a modal submit the button is still highlighted but no
    // range is sent. Asserting the invariant directly: highlighted <=> range present.
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await applyModal(page, h, () => tick(page, 'Prepped'));
    const highlighted = await quickBar(page).locator('button.btn-primary').count();
    expect(highlighted > 0).toBe((v.filter.AND ?? []).length > 0);
  });
});

test.describe('DnD table: sorting @mocked', () => {
  test('the default sort is ID descending', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await expect(table(page).locator('thead th').first()).toHaveAttribute('aria-sort', 'descending');
    expect(h.reqs[h.reqs.length - 1].page!.sort).toEqual([{ key: 'id', value: 'desc' }]);
  });

  test('clicking the sorted ID header never sends an empty sort', async ({ page }) => {
    // DEFECT: DataTables 2 cycles a sorted header through "remove sorting" (aria: "ID: Activate to remove
    // sorting"), so one click on the default-sorted ID column sends `sort: []`. The server then returns an
    // unspecified order, and paging through an unordered result set can repeat or skip rows.
    // Fix: orderable columns need `orderSequence: ['asc','desc']`, or the ajax fn should fall back to id desc.
    // component: distributions-and-deliveries-index.component.ts:475-480 / :546
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => table(page).locator('thead th').first().click());
    expect(v.page!.sort.length).toBeGreaterThan(0);
  });

  test('sorting by Client Ref and by Collection/Delivery Date sends those keys', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    let v = await h.after(() => table(page).locator('thead th', { hasText: 'Client Ref' }).click());
    expect(v.page!.sort).toEqual([{ key: 'clientRef', value: 'asc' }]);
    await expectIds(page, ids(FIX.rows.filter(nonSales).sort((a, b) => a.id - b.id).slice(0, 10)));

    v = await h.after(() => table(page).locator('thead th', { hasText: 'Collection/Delivery Date' }).click());
    expect(v.page!.sort).toEqual([{ key: 'collectionDate', value: 'asc' }]);
  });

  test('sorting while on page 3 returns to page 1', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => goToPage(page, 3));
    const v = await h.after(() => table(page).locator('thead th', { hasText: 'Client Ref' }).click());
    expect(v.page!.page).toBe(0);
  });

  test('the Is Prepped column (a checkbox, not sortable data) is not offered as a sort', async ({ page }) => {
    // DEFECT: columns[10] is `{data: null, orderable: false}` but it is the "Is Prepped" column, while
    // the real isPrepped data is never sortable; and the Requests column (index 1) IS orderable
    // with key `deviceRequestItems` - an object, which the API cannot sort by. Clicking "Requests"
    // sends sort key deviceRequestItems. Pin: no header sends an object-valued key.
    // component: distributions-and-deliveries-index.component.ts:547
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => table(page).locator('thead th', { hasText: 'Requests' }).click());
    expect(v.page!.sort[0].key).not.toBe('deviceRequestItems');
  });
});

test.describe('DnD table: persistence across reload @mocked', () => {
  test('modal filter and DataTables page size/sort survive a reload, and the badge/total still agree', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await h.after(() => lengthSelect(page).selectOption('25'));
    await page.waitForFunction((k) => !!localStorage.getItem(k), DT_STATE_KEY);

    h.reqs.length = 0;
    await page.reload();
    await expect(dataRows(page).first()).toBeVisible({ timeout: 30_000 });
    const prepped = FIX.rows.filter(nonSales).filter((r) => r.isPrepped);
    await expectInfo(page, 1, Math.min(25, prepped.length), prepped.length);
    expect(h.last().filter.isPrepped).toEqual({ _in: [true] });
    expect(h.last().page!.size).toBe(25);
    await expect(filterBadge(page)).toHaveText('2');
    await expect(lengthSelect(page)).toHaveValue('25');
  });

  test('a restored week range is visible and clearable from the page', async ({ page }) => {
    // DEFECT: the week range is persisted in localStorage, but `activeFilter` is not. After a reload the
    // range is still applied (badge 3) yet no week button is highlighted and the Clear button does not
    // render - the date filter can neither be seen nor removed except by clearing site data.
    // component: distributions-and-deliveries-index.component.ts:270 vs 571
    test.fail();
    test.setTimeout(60_000);
    const { start, end } = weekRange(0);
    const h = await setup(page, {
      localStorage: {
        [FILTER_KEY]: JSON.stringify({ is_sales: [false], collectionDateStart: start.toISOString(), collectionDateEnd: end.toISOString() }),
      },
    });
    await page.goto(PATH);
    await expect(filterBadge(page)).toHaveText('3', { timeout: 30_000 });
    expect(h.last().filter.AND.length).toBe(2);
    await expect(clearButton(page)).toBeVisible({ timeout: 2_000 });
  });

  test('a corrupt saved filter falls back to the default non-commercial view', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page, { localStorage: { [FILTER_KEY]: '{not json' } });
    await load(page, h);
    await expect(filterBadge(page)).toHaveText('1');
    await expectInfo(page, 1, 10, 54);
  });

  test('a saved page number beyond the (filtered) result set does not strand the user on an empty page', async ({ page }) => {
    // Saved DataTables state says page 6; the saved filter then shrinks the set to < 1 page.
    test.setTimeout(60_000);
    const h = await setup(page, { localStorage: { [FILTER_KEY]: JSON.stringify({ is_sales: [false], status: ['NEW'] }) } });
    await page.addInitScript(([k, id]) => {
      if (!localStorage.getItem(k as string)) {
        localStorage.setItem(k as string, JSON.stringify({
          time: Date.now(), start: 50, length: 10, order: [[0, 'desc']], search: { search: '' },
          columns: Array.from({ length: 11 }, () => ({ visible: true, search: { search: '' } })),
        }));
      }
      void id;
    }, [DT_STATE_KEY, TABLE_ID]);
    await page.goto(PATH);
    const newOnes = FIX.rows.filter(nonSales).filter((r) => r.status === 'NEW').sort(byIdDesc);
    await expectIds(page, ids(newOnes.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, newOnes.length), newOnes.length);
    expect(h.last().page!.page).toBe(0);
  });
});

test.describe('DnD table: counts and row badges @mocked', () => {
  test('info line, last pager number and Filter badge all agree with totalElements under every filter', async ({ page }) => {
    test.setTimeout(120_000);
    const h = await setup(page);
    await load(page, h);

    const check = async (expectedRows: Row[], badge: string | null) => {
      const total = expectedRows.length;
      await expectInfo(page, total ? 1 : 0, Math.min(10, total), total);
      const pages = Math.ceil(total / 10);
      if (pages > 1) {
        await expect(pager(page).getByRole('link', { name: String(pages), exact: true })).toBeVisible();
        await expect(pager(page).getByRole('link', { name: String(pages + 1), exact: true })).toHaveCount(0);
      }
      if (badge === null) await expect(filterBadge(page)).toHaveCount(0);
      else await expect(filterBadge(page)).toHaveText(badge);
    };

    await check(FIX.rows.filter(nonSales), '1');
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await check(FIX.rows.filter(nonSales).filter((r) => r.isPrepped), '2');
    await applyModal(page, h, () => tick(page, 'Delivery'));
    await check(FIX.rows.filter(nonSales).filter((r) => r.isPrepped && r.collectionMethod === 'DELIVERY'), '3');
    await applyModal(page, h, () => tick(page, 'Commercial'));
    await check(FIX.rows.filter((r) => r.isPrepped && r.collectionMethod === 'DELIVERY'), '4');
  });

  test('row requested/allocated badges count kits per type (allocated / requested)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('CR-008'));
    await expectIds(page, [8]);
    const cell = dataRows(page).first().locator('td:nth-child(2)');
    // Row 8 asked for 3 laptops and holds 2 laptop kits (+1 smartphone it did not ask for).
    await expect(cell.locator('.badge-primary', { hasText: 'Laptops' })).toContainText(/2\s*\/\s*3/);
    await expect(cell).toContainText('9001');
    await expect(cell).toContainText('9003');
    // No request for tablets -> no tablets badge.
    await expect(cell.locator('.badge-primary', { hasText: 'Tablets' })).toHaveCount(0);
  });

  test('an allocated kit of type OTHER is counted and listed on the row', async ({ page }) => {
    // DEFECT: kits are bucketed as `${type}S`, so an OTHER kit lands in 'OTHERS' while the template
    // reads types['OTHER']. A request that asked for "other" devices always shows 0 allocated and
    // its kit ids are never listed. (The other seven kit types happen to pluralise correctly.)
    // component: distributions-and-deliveries-index.component.ts:505-506
    test.fail();
    test.setTimeout(60_000);
    // Row 20 needs an OTHER request for the badge to render at all.
    const h = await setup(page);
    FIX.rows[19].deviceRequestItems.other = 1;
    try {
      await load(page, h);
      await h.after(() => searchBox(page).fill('CR-020'));
      await expectIds(page, [20]);
      const cell = dataRows(page).first().locator('td:nth-child(2)');
      await expect(cell.locator('.badge-primary', { hasText: 'Other' })).toContainText(/1\s*\/\s*1/);
      await expect(cell).toContainText('9010');
    } finally {
      FIX.rows[19].deviceRequestItems.other = 0;
    }
  });

  test('a request that wants nothing shows no device badges', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => searchBox(page).fill('CR-001'));
    await expectIds(page, [1]);
    await expect(dataRows(page).first().locator('td:nth-child(2) .badge')).toHaveCount(0);
  });

  test('every response row renders: ids on screen are unique and equal the requested page', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => lengthSelect(page).selectOption('50'));
    const shown = await shownIds(page);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(50);
    await expectInfo(page, 1, 50, 54);
  });
});

test.describe('DnD table: errors and stale responses @mocked', () => {
  test('a failed query raises a GraphQL Error warning, and changing page size recovers', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    h.failNext(1);
    await h.after(() => goToPage(page, 2));
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error', { timeout: 10_000 });
    await h.after(() => lengthSelect(page).selectOption('25'));
    const expected = FIX.rows.filter(nonSales).sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 25)));
    await expectInfo(page, 1, 25, 54);
  });

  test('after a failed query the pager still lets the user retry or go back', async ({ page }) => {
    // DEFECT: the error branch answers recordsTotal = recordsFiltered = 0, so DataTables redraws the pager
    // with no page links ("Previous/Next" both disabled). A transient error therefore strands the user:
    // only reload, a new search/filter or a page-size change re-issues a request.
    // component: distributions-and-deliveries-index.component.ts:527-534
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    h.failNext(1);
    await h.after(() => goToPage(page, 2));
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error', { timeout: 10_000 });
    await expect(pager(page).getByRole('link', { name: '1', exact: true })).toBeVisible({ timeout: 2_000 });
  });

  test('a failed query does not leave the previous page showing under the new page number', async ({ page }) => {
    // DEFECT: on error the ajax callback reports zero rows but never clears `entities`, so the
    // PREVIOUS page's rows stay on screen while the info line/pager say "0 entries"/page 2.
    // component: distributions-and-deliveries-index.component.ts:527-543 (error branch lacks entities = [])
    test.fail();
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    h.failNext(1);
    await h.after(() => goToPage(page, 2));
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error', { timeout: 10_000 });
    await expect.poll(() => shownIds(page)).toEqual([]);
  });

  test('the table shows a processing state while a request is in flight and none after', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const gate = h.hold();
    await h.after(() => goToPage(page, 2));
    await expect(page.locator(`#${TABLE_ID}_processing`)).toBeVisible();
    gate.release();
    await expect(page.locator(`#${TABLE_ID}_processing`)).toBeHidden();
  });
});

/*
 * NOT COVERABLE IN @mocked - needs a live-UAT spec
 *   - Real server semantics of the filter variables: that `deviceRequestItems: {laptops:{_gt:0}}`
 *     really ANDs; that `isSales` exists as a filter field; that `collectionDate _gte/_lte` compare
 *     the same instant the table displays (timezone/BST edges at week boundaries).
 *   - Which sort keys the API accepts: `referringOrganisationContact.fullName` and
 *     `referringOrganisationContact.referringOrganisation.name` (dotted, nested) and the object-valued
 *     `deviceRequestItems`; the stub sorts them locally so it cannot tell.
 *   - Whether `_contains: ""` on `clientRef` (empty term) really matches NULL clientRefs; the empty-search
 *     view could silently drop requests with no client ref.
 *   - The header global search box (SearchQuery -> CoreWidgetState.query -> table.search): it is a
 *     separate path to the same reload and shares the page-reset defect, but lives in the app header.
 *   - The Delivery Slots tab (flag ON) and its counts - covered by delivery-slots-*.spec.ts.
 */
