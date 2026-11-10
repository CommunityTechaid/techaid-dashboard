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

/** Independent en-GB label: '2–8 Nov', or '30 Nov – 6 Dec' across a month boundary. */
function weekLabel(i: number): string {
  const { start, end } = weekRange(i);
  const mon = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' });
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${mon(end)}`
    : `${start.getDate()} ${mon(start)} – ${end.getDate()} ${mon(end)}`;
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

// Mirrors the server's DeviceRequestItemsWhereInput: fields AND together, an OR list is one grouped alternative.
function matchesItems(r: Row, f: any): boolean {
  for (const [k, cond] of Object.entries<any>(f)) {
    if (k === 'OR' || k === 'AND') continue;
    if (!((r.deviceRequestItems[k] ?? 0) > cond._gt)) return false;
  }
  if (f.AND && !f.AND.every((c: any) => matchesItems(r, c))) return false;
  if (f.OR && f.OR.length && !f.OR.some((c: any) => matchesItems(r, c))) return false;
  return true;
}

function matchesFilter(r: Row, f: any): boolean {
  if (!f) return true;
  if (f.status && !f.status._in.includes(r.status)) return false;
  if (f.isSales && !f.isSales._in.includes(FIX.meta.get(r.id)!.isSales)) return false;
  if (f.isPrepped && !f.isPrepped._in.includes(r.isPrepped)) return false;
  if (f.collectionMethod && !f.collectionMethod._in.includes(r.collectionMethod)) return false;
  if (f.deviceRequestItems && !matchesItems(r, f.deviceRequestItems)) return false;
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
/** The week view's implicit open-status scope, sorted (excludes on-hold, failed, declined, cancelled). */
const OPEN_SORTED = ['NEW', 'PROCESSING_COLLECTION_DELIVERY_ARRANGED', 'PROCESSING_EQUALITIES_DATA_COMPLETE', 'REQUEST_COMPLETED'].sort();
const onHoldButton = (page: Page) => quickBar(page).getByRole('button', { name: 'On hold', exact: true });
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
    // Was a DEFECT pin (#291): DataTables' own initial draw fired before ngAfterViewInit applied the
    // saved/default filter, so the first request was UNFILTERED (commercial rows too) and a second,
    // filtered, one followed. deferLoading now leaves the first request to applyFilter().
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    expect(h.reqs[0].filter?.isSales).toEqual({ _in: [false] });
  });

  test('only one request is made on initial load', async ({ page }) => {
    // Was a DEFECT pin (#291): initial load issued two requests (unfiltered draw + filtered reload).
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
    // Was a DEFECT pin (#291): every total this table reports is already filtered, so with zero matches
    // DataTables picked its emptyTable text ("No data available in table"), which reads as "the database
    // is empty". language.emptyTable now carries the zeroRecords wording.
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
    await expect(table(page)).toContainText('No matching records found');
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

  test('device-type filter sends one _gt:0 alternative per type', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await applyModal(page, h, () => tick(page, 'Laptops'));
    expect(v.filter.deviceRequestItems).toEqual({ OR: [{ laptops: { _gt: 0 } }] });
    const expected = FIX.rows.filter(nonSales).filter((r) => r.deviceRequestItems.laptops > 0).sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, expected.length), expected.length);
    await expect(filterBadge(page)).toHaveText('2');
  });

  test('ticking two device types returns requests that want EITHER type', async ({ page }) => {
    // Was a DEFECT pin (#291): the types were ANDed, so Laptops + Phones returned only requests
    // asking for BOTH. Every other multi-tick control in this modal is an OR/_in.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, async () => {
      await tick(page, 'Laptops');
      await tick(page, 'Phones');
    });
    const v = h.last();
    expect(v.filter.deviceRequestItems).toEqual({ OR: [{ laptops: { _gt: 0 } }, { phones: { _gt: 0 } }] });
    const either = FIX.rows.filter(nonSales).filter((r) => r.deviceRequestItems.laptops > 0 || r.deviceRequestItems.phones > 0);
    const both = either.filter((r) => r.deviceRequestItems.laptops > 0 && r.deviceRequestItems.phones > 0);
    expect(either.length).toBeGreaterThan(both.length); // the fixture can tell OR from AND
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
    // Status Cancelled AND wants tablets: no fixture row asks for tablets, so nothing matches.
    await applyModal(page, h, async () => {
      await pickStatuses(page, ['Cancelled']);
      await tick(page, 'Tablets');
    });
    const expected = FIX.rows.filter(nonSales).filter(
      (r) => r.status === 'REQUEST_CANCELLED' && r.deviceRequestItems.tablets > 0,
    );
    expect(expected.length).toBe(0);
    await expectIds(page, []);
    await expectInfo(page, 0, 0, 0);
    await expect(table(page)).toContainText('No matching records found');
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
    // Was a DEFECT pin (#291): the modal had no Reset, and the page "Clear" button only clears the
    // quick filters. RESET returns to the page default (non-commercial only, quick filters off),
    // like the device list's RESET (#76).
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await h.after(() => onHoldButton(page).click());
    await openFilter(page);
    const reset = page.locator('.modal-footer').getByRole('button', { name: /clear|reset/i });
    await expect(reset).toBeVisible({ timeout: 2_000 });
    const v = await h.after(() => reset.click());
    await expect(page.locator('.modal-title')).toHaveCount(0);
    expect(v.filter).toEqual({ AND: [], isSales: { _in: [false] } });
    // The window agrees with what was sent when it is opened again.
    await openFilter(page);
    await expect(modalBody(page).getByLabel('Prepped', { exact: true })).not.toBeChecked();
    await expect(modalBody(page).getByLabel('Non-commercial', { exact: true })).toBeChecked();
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
    expect(labels).toEqual([0, 1, 2, 3].map(weekLabel));
    // en-GB range, never the US 'Nov 2' form.
    for (const l of labels) expect(l).toMatch(/^\d{1,2}( [A-Z][a-z]{2})? – ?\d{1,2} [A-Z][a-z]{2}$|^\d{1,2}–\d{1,2} [A-Z][a-z]{2}$/);
  });

  test('week buttons are re-derived when the tab becomes visible again after a Monday passes', async ({ page }) => {
    // #284: buttons were computed once in ngOnInit, so a tab left open across a Monday kept last week's labels.
    // (Load at real time so the fake Auth0 token is valid; only move the clock after the page is up.)
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const before = (await weekButtons(page).allInnerTexts()).map((t) => t.trim());
    expect(before).toEqual([0, 1, 2, 3].map(weekLabel));

    const nextMonday = weekRange(1).start;
    nextMonday.setHours(9, 0, 0, 0);
    await page.clock.setFixedTime(nextMonday);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(weekButtons(page).first()).toHaveText(weekLabel(1));
    const after = (await weekButtons(page).allInnerTexts()).map((t) => t.trim());
    expect(after.slice(0, 3)).toEqual(before.slice(1));
  });
  test('a week button sends the Mon-Sun collectionDate range, highlights, shows Clear and counts as ONE filter', async ({ page }) => {
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
    const inWeek = FIX.rows.filter(nonSales).filter((r) => !['REQUEST_DECLINED', 'REQUEST_CANCELLED', 'REQUEST_COLLECTION_DELIVERY_FAILED', 'PROCESSING_ON_HOLD'].includes(r.status) && r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end).sort(byIdDesc);
    await expectIds(page, ids(inWeek.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, inWeek.length), inWeek.length);
    await expect(filterBadge(page)).toHaveText('2'); // non-commercial + the week (a date range counts once)
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
    // Was a DEFECT pin (#280): week then Failed sent both constraints but lit only Failed.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await h.after(() => failedButton(page).click());
    expect(v.filter.AND.length).toBe(2);
    // Additive (staff feedback 2026-11-10): the week's open requests PLUS its failed ones.
    expect(v.filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'REQUEST_COLLECTION_DELIVERY_FAILED'].sort());
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/);
    await expect(failedButton(page)).toHaveClass(/btn-success/);
    await expect(filterBadge(page)).toHaveText('3'); // non-commercial + failed + week
  });

  test('Failed then a week keeps the Failed status (status is not dropped) and both stay lit', async ({ page }) => {
    // #280 point 3, the other order: status then week used to drop the status.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => failedButton(page).click());
    const v = await h.after(() => weekButtons(page).nth(1).click());
    expect(v.filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'REQUEST_COLLECTION_DELIVERY_FAILED'].sort());
    expect(v.filter.AND.length).toBe(2);
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    await expect(failedButton(page)).toHaveClass(/btn-success/);
    const { start, end } = weekRange(1);
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => [...OPEN_SORTED, 'REQUEST_COLLECTION_DELIVERY_FAILED'].includes(r.status) && r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end)
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
  });

  test('a week view shows open statuses only by default (#42), and drops declined/cancelled/failed/on-hold rows', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => weekButtons(page).nth(0).click());
    expect(v.filter.status._in.slice().sort()).toEqual(
      ['NEW', 'PROCESSING_COLLECTION_DELIVERY_ARRANGED', 'PROCESSING_EQUALITIES_DATA_COMPLETE', 'REQUEST_COMPLETED'],
    );
    const { start, end } = weekRange(0);
    const open = ['NEW', 'PROCESSING_EQUALITIES_DATA_COMPLETE', 'PROCESSING_COLLECTION_DELIVERY_ARRANGED', 'REQUEST_COMPLETED'];
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => open.includes(r.status) && r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end)
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expectInfo(page, 1, Math.min(10, expected.length), expected.length);
    // The implicit scope is not counted as the user's filters: non-commercial + week.
    await expect(filterBadge(page)).toHaveText('2');
  });

  test('a status picked in the Filter window wins over the week default (declined rows can be shown)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => pickStatuses(page, ['Declined']));
    const v = await h.after(() => weekButtons(page).nth(0).click());
    expect(v.filter.status).toEqual({ _in: ['REQUEST_DECLINED'] });
  });

  test('a week button after a modal status keeps the status', async ({ page }) => {
    // Was a DEFECT pin (#280): applyWeekFilter deleted `status`, including the modal's choice.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => pickStatuses(page, ['On hold']));
    const v = await h.after(() => weekButtons(page).nth(0).click());
    expect(v.filter.status).toEqual({ _in: ['PROCESSING_ON_HOLD'] });
  });

  test('Clear leaves modal-chosen statuses alone', async ({ page }) => {
    // Was a DEFECT pin (#280): clearQuickFilters deleted `status` unconditionally.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await applyModal(page, h, () => pickStatuses(page, ['On hold']));
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await h.after(() => clearButton(page).click());
    expect(v.filter.status).toEqual({ _in: ['PROCESSING_ON_HOLD'] });
    expect(v.filter.AND).toEqual([]);
    await expect(clearButton(page)).toHaveCount(0);
  });

  test('submitting the filter modal after a week button keeps the week range', async ({ page }) => {
    // Was a DEFECT pin (#280): the modal submit lost collectionDateStart/End while the button stayed lit.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    const v = await applyModal(page, h, () => tick(page, 'Prepped'));
    expect(v.filter.AND?.length).toBe(2);
    expect(v.filter.isPrepped).toEqual({ _in: [true] });
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/);
    await expect(clearButton(page)).toBeVisible();
  });

  test('the week button highlight always agrees with whether a date range is being sent', async ({ page }) => {
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
    // Was a DEFECT pin (#291): DataTables 2 cycles a sorted header through "remove sorting", so one click
    // on the default-sorted ID column sent `sort: []` and the server returned an unspecified order.
    // Columns now use orderSequence ['asc','desc'], and an empty sort falls back to id desc.
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

  test('the Requests column (an embedded object) is not offered as a sort', async ({ page }) => {
    // Was a DEFECT pin (#284): clicking "Requests" sent sort key deviceRequestItems, an object the
    // API cannot order by. The column is now orderable:false, so a click sends nothing.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const n = h.reqs.length;
    await table(page).locator('thead th', { hasText: 'Requests' }).click();
    await page.waitForTimeout(800);
    expect(h.reqs.length).toBe(n);
    expect(h.reqs.some((r) => r.page?.sort?.some((s) => s.key === 'deviceRequestItems'))).toBe(false);
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

  test('a restored week range (old saved format) is visible and clearable from the page', async ({ page }) => {
    // Was a DEFECT pin (#280): the week survived a reload but nothing was lit and Clear did not render.
    // Old saves stored fixed ISO strings; they are converted to a week and lit when still offered.
    test.setTimeout(60_000);
    const { start, end } = weekRange(0);
    const h = await setup(page, {
      localStorage: {
        [FILTER_KEY]: JSON.stringify({ is_sales: [false], collectionDateStart: start.toISOString(), collectionDateEnd: end.toISOString() }),
      },
    });
    await page.goto(PATH);
    await expect(filterBadge(page)).toHaveText('2', { timeout: 30_000 });
    expect(h.last().filter.AND.length).toBe(2);
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/);
    await expect(clearButton(page)).toBeVisible({ timeout: 2_000 });
  });

  test('a week and the Failed button survive a reload, both lit', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(2).click());
    await h.after(() => failedButton(page).click());
    h.reqs.length = 0;
    await page.reload();
    await expect(filterBadge(page)).toHaveText('3', { timeout: 30_000 });
    await expect(weekButtons(page).nth(2)).toHaveClass(/btn-primary/);
    await expect(failedButton(page)).toHaveClass(/btn-success/);
    expect(h.last().filter.AND.length).toBe(2);
  });

  test('a saved week that is no longer offered is dropped, not silently re-applied', async ({ page }) => {
    // #280 point 1: last month's week used to stay applied with nothing lit and no Clear button.
    test.setTimeout(60_000);
    const h = await setup(page, {
      localStorage: {
        [FILTER_KEY]: JSON.stringify({ is_sales: [false], collectionDateStart: '2020-03-02T00:00:00.000Z', collectionDateEnd: '2020-03-08T23:59:59.999Z' }),
      },
    });
    await load(page, h);
    expect(h.last().filter.AND).toEqual([]);
    await expect(filterBadge(page)).toHaveText('1');
    await expect(clearButton(page)).toHaveCount(0);
    await expect(quickBar(page).locator('button.btn-primary')).toHaveCount(0);
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
    // Was a DEFECT pin (#291): kits were bucketed as `${type}S`, so an OTHER kit landed in 'OTHERS'
    // while the template reads types['OTHER']: "other" requests always showed 0 allocated.
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

  test('null device counts render no badge (null is not 0)', async ({ page }) => {
    // #284: deviceRequestItems.* are nullable and `null != 0` is true, so empty counts showed 'Other 0 / 0'.
    test.setTimeout(60_000);
    const h = await setup(page);
    const saved = FIX.rows[0].deviceRequestItems;
    FIX.rows[0].deviceRequestItems = { phones: null, tablets: null, laptops: null, allInOnes: null, desktops: null, commsDevices: null, other: null } as any;
    try {
      await load(page, h);
      await h.after(() => searchBox(page).fill('CR-001'));
      await expectIds(page, [1]);
      await expect(dataRows(page).first().locator('td:nth-child(2) .badge')).toHaveCount(0);
    } finally {
      FIX.rows[0].deviceRequestItems = saved;
    }
  });

  test('the read-only Prepped checkbox is labelled and disabled', async ({ page }) => {
    // #284: it had no accessible name and was a live-looking control.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const boxes = dataRows(page).getByRole('checkbox', { name: 'Prepped' });
    await expect(boxes).toHaveCount(await dataRows(page).count());
    await expect(boxes.first()).toBeDisabled();
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
    // Was a DEFECT pin (#291): the error branch answered zero totals, so the pager lost its page links
    // and a transient error stranded the user. It now reports the last known total.
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    h.failNext(1);
    await h.after(() => goToPage(page, 2));
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error', { timeout: 10_000 });
    await expect(pager(page).getByRole('link', { name: '1', exact: true })).toBeVisible({ timeout: 2_000 });
  });

  test('a failed query does not leave the previous page showing under the new page number', async ({ page }) => {
    // Was a DEFECT pin (#291): on error `entities` was never cleared, so the PREVIOUS page's rows
    // stayed on screen under the new page number.
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

// ---------------------------------------------------------------------------------------------
// #282: filters + active tab in the URL
// ---------------------------------------------------------------------------------------------

const weekKey = (i: number): string => {
  const d = weekRange(i).start;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const query = (page: Page): URLSearchParams => new URL(page.url()).searchParams;
const slotsTab = (page: Page) => page.locator('a.nav-link', { hasText: 'Delivery Slots' });
const requestsTab = (page: Page) => page.locator('a.nav-link', { hasText: 'Device Requests' });

/** Opens a deep link and waits until the filtered query (not DataTables' unfiltered first draw) has been sent. */
async function openLink(page: Page, h: Harness, search: string, settled: (v: Vars) => boolean): Promise<void> {
  await page.goto(`${PATH}${search}`);
  await expect.poll(() => h.reqs.some(settled), { timeout: 30_000 }).toBe(true);
  await expect(info(page)).toContainText('Showing', { timeout: 15_000 });
}

test.describe('DnD table: filters and tab in the URL @mocked', () => {
  test('a deep link applies the filters and lights the right buttons', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await openLink(page, h, `?week=${weekKey(1)}&prepped=no&method=delivery`, (v) => !!v.filter?.isPrepped);
    const v = h.last();
    const { start, end } = weekRange(1);
    expect(v.filter.AND).toEqual([
      { collectionDate: { _gte: start.toISOString() } },
      { collectionDate: { _lte: end.toISOString() } },
    ]);
    expect(v.filter.isPrepped).toEqual({ _in: [false] });
    expect(v.filter.collectionMethod).toEqual({ _in: ['DELIVERY'] });
    expect(v.filter.isSales).toEqual({ _in: [false] }); // default when `sales` is absent
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    await expect(quickBar(page).locator('button.btn-primary')).toHaveCount(1);
    await expect(clearButton(page)).toBeVisible();
    await expect(filterBadge(page)).toHaveText('4'); // non-commercial + not prepped + delivery + week
    const open = ['NEW', 'PROCESSING_EQUALITIES_DATA_COMPLETE', 'PROCESSING_COLLECTION_DELIVERY_ARRANGED', 'REQUEST_COMPLETED'];
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => !r.isPrepped && r.collectionMethod === 'DELIVERY' && open.includes(r.status) && r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end)
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
  });

  test('a deep link with status, device, failed and commercial params', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await openLink(page, h, '?status=NEW,PROCESSING_ON_HOLD&device=LAPTOPS&sales=no,yes&failed=yes', (v) => !!v.filter?.deviceRequestItems);
    const v = h.last();
    expect(v.filter.status._in.slice().sort()).toEqual(['NEW', 'PROCESSING_ON_HOLD', 'REQUEST_COLLECTION_DELIVERY_FAILED']);
    expect(v.filter.deviceRequestItems).toEqual({ OR: [{ laptops: { _gt: 0 } }] });
    expect(v.filter.isSales._in.slice().sort()).toEqual([false, true]);
    await expect(failedButton(page)).toHaveClass(/btn-success/);
  });

  test('the On hold button filters to PROCESSING_ON_HOLD, highlights green and is in the URL', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    const v = await h.after(() => onHoldButton(page).click());
    expect(v.filter.status).toEqual({ _in: ['PROCESSING_ON_HOLD'] });
    await expect(onHoldButton(page)).toHaveClass(/btn-success/);
    await expect(failedButton(page)).toHaveClass(/btn-outline-success/);
    await expect.poll(() => query(page).get('onhold')).toBe('yes');
    const onHold = FIX.rows.filter(nonSales).filter((r) => r.status === 'PROCESSING_ON_HOLD').sort(byIdDesc);
    await expectIds(page, ids(onHold.slice(0, 10)));
    await expect(filterBadge(page)).toHaveText('2'); // non-commercial + on hold
  });

  test('a week plus On hold ADDS that week\'s on-hold rows; plus Failed adds failed rows too', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    let v = await h.after(() => onHoldButton(page).click());
    expect(v.filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'PROCESSING_ON_HOLD'].sort());
    expect(v.filter.AND.length).toBe(2);
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/);
    const { start, end } = weekRange(0);
    const expected = FIX.rows
      .filter(nonSales)
      .filter((r) => [...OPEN_SORTED, 'PROCESSING_ON_HOLD'].includes(r.status) && r.collectionDate && Date.parse(r.collectionDate) >= +start && Date.parse(r.collectionDate) <= +end)
      .sort(byIdDesc);
    await expectIds(page, ids(expected.slice(0, 10)));
    await expect(filterBadge(page)).toHaveText('3'); // non-commercial + week + on hold
    v = await h.after(() => failedButton(page).click());
    expect(v.filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'PROCESSING_ON_HOLD', 'REQUEST_COLLECTION_DELIVERY_FAILED'].sort());
    // Clear drops both status buttons and the week together.
    v = await h.after(() => clearButton(page).click());
    expect(v.filter.status).toBeUndefined();
    await expect(onHoldButton(page)).toHaveClass(/btn-outline-success/);
    expect(query(page).has('onhold')).toBe(false);
  });

  test('a deep link with onhold=yes lights the On hold button', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await openLink(page, h, `?week=${weekKey(0)}&onhold=yes`, (v) => (v.filter?.AND ?? []).length === 2);
    expect(h.last().filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'PROCESSING_ON_HOLD'].sort());
    await expect(onHoldButton(page)).toHaveClass(/btn-success/);
  });

  test('clicking a lit Failed or On hold button again switches just that button off', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(0).click());
    await h.after(() => onHoldButton(page).click());
    await h.after(() => failedButton(page).click());
    let v = await h.after(() => failedButton(page).click());
    expect(v.filter.status._in.slice().sort()).toEqual([...OPEN_SORTED, 'PROCESSING_ON_HOLD'].sort());
    await expect(failedButton(page)).toHaveClass(/btn-outline-success/);
    await expect(onHoldButton(page)).toHaveClass(/btn-success/);
    await expect(weekButtons(page).nth(0)).toHaveClass(/btn-primary/);
    v = await h.after(() => onHoldButton(page).click());
    expect(v.filter.status._in.slice().sort()).toEqual(OPEN_SORTED);
    await expect.poll(() => query(page).has('onhold') || query(page).has('failed')).toBe(false);
    expect(query(page).get('week')).toBe(weekKey(0));
  });

  test('URL filters win over saved filters', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page, { localStorage: { [FILTER_KEY]: JSON.stringify({ is_sales: [false], is_prepped: [true] }) } });
    await openLink(page, h, '?prepped=no', (v) => !!v.filter?.isPrepped && v.filter.isPrepped._in[0] === false);
    expect(h.last().filter.isPrepped).toEqual({ _in: [false] });
  });

  test('a link with no filter params still uses the saved filters (tab alone does not override them)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page, { localStorage: { [FILTER_KEY]: JSON.stringify({ is_sales: [false], is_prepped: [true] }) } });
    await openLink(page, h, '?tab=requests&utm_source=email', (v) => !!v.filter?.isPrepped);
    expect(h.last().filter.isPrepped).toEqual({ _in: [true] });
  });

  test('unknown params and invalid values are ignored safely, and unknown params survive', async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const h = await setup(page);
    await openLink(page, h, '?foo=bar&status=NOT_A_STATUS,constructor&week=garbage&tab=nonsense&method=teleport&device=__proto__&prepped=maybe', (v) => !!v.filter?.isSales);
    const v = h.last();
    expect(v.filter.status).toBeUndefined();
    expect(v.filter.AND).toEqual([]);
    expect(v.filter.isPrepped).toBeUndefined();
    expect(v.filter.collectionMethod).toBeUndefined();
    expect(v.filter.deviceRequestItems).toBeUndefined();
    expect(v.filter.isSales).toEqual({ _in: [false] });
    await expect(requestsTab(page)).toHaveClass(/active/);
    expect(errors).toEqual([]);
    // Interacting keeps the foreign param.
    await h.after(() => weekButtons(page).nth(0).click());
    expect(query(page).get('foo')).toBe('bar');
    expect(query(page).get('week')).toBe(weekKey(0));
  });

  test('a week date that is not a Monday snaps to its Monday', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    const wed = weekRange(1).start;
    wed.setDate(wed.getDate() + 2);
    const p = (n: number) => String(n).padStart(2, '0');
    const wedKey = `${wed.getFullYear()}-${p(wed.getMonth() + 1)}-${p(wed.getDate())}`;
    await openLink(page, h, `?week=${wedKey}`, (v) => (v.filter?.AND ?? []).length === 2);
    expect(h.last().filter.AND[0]).toEqual({ collectionDate: { _gte: weekRange(1).start.toISOString() } });
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
  });

  test('changing filters writes them to the URL, defaults leave it clean', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    expect(page.url()).not.toContain('?');
    await h.after(() => weekButtons(page).nth(2).click());
    await expect.poll(() => query(page).get('week')).toBe(weekKey(2));
    await h.after(() => failedButton(page).click());
    await expect.poll(() => query(page).get('failed')).toBe('yes');
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await expect.poll(() => query(page).get('prepped')).toBe('yes');
    expect(query(page).has('sales')).toBe(false);
    expect(query(page).has('tab')).toBe(false);
    await h.after(() => clearButton(page).click());
    await expect.poll(() => query(page).has('week') || query(page).has('failed')).toBe(false);
    expect(query(page).get('prepped')).toBe('yes');
  });

  test('reload restores state from the URL alone (saved filters wiped)', async ({ page }) => {
    test.setTimeout(60_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(1).click());
    await applyModal(page, h, () => untick(page, 'Non-commercial'));
    await expect.poll(() => query(page).get('sales')).toBe('all');
    await page.evaluate((k) => localStorage.removeItem(k), FILTER_KEY);
    h.reqs.length = 0;
    await page.reload();
    await expect.poll(() => h.reqs.some((v) => !v.filter?.isSales && (v.filter?.AND ?? []).length === 2), { timeout: 30_000 }).toBe(true);
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    await expect(filterBadge(page)).toHaveText('1'); // only the week; no commercial constraint
  });

  test('back and forward walk through filter changes', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await load(page, h);
    await h.after(() => weekButtons(page).nth(1).click());
    await expect.poll(() => query(page).get('week')).toBe(weekKey(1));
    await applyModal(page, h, () => tick(page, 'Prepped'));
    await expect.poll(() => query(page).get('prepped')).toBe('yes');

    // Back: the Prepped filter goes, the week stays.
    let v = await h.after(() => page.goBack());
    expect(v.filter.isPrepped).toBeUndefined();
    expect(v.filter.AND.length).toBe(2);
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    expect(query(page).has('prepped')).toBe(false);

    // Back again: no week.
    v = await h.after(() => page.goBack());
    expect(v.filter.AND).toEqual([]);
    await expect(quickBar(page).locator('button.btn-primary')).toHaveCount(0);
    await expect(clearButton(page)).toHaveCount(0);

    // Forward twice: week, then week + prepped.
    await h.after(() => page.goForward());
    v = await h.after(() => page.goForward());
    expect(v.filter.isPrepped).toEqual({ _in: [true] });
    expect(v.filter.AND.length).toBe(2);
    await expect(weekButtons(page).nth(1)).toHaveClass(/btn-primary/);
    await expect(filterBadge(page)).toHaveText('3');
  });

  test('the active tab is in the URL: deep link, click, reload and back', async ({ page }) => {
    test.setTimeout(90_000);
    const h = await setup(page);
    await openLink(page, h, '?tab=slots', (v) => !!v.filter);
    await expect(slotsTab(page)).toHaveClass(/active/);
    await expect(requestsTab(page)).not.toHaveClass(/active/);

    await requestsTab(page).click();
    await expect(requestsTab(page)).toHaveClass(/active/);
    await expect.poll(() => query(page).has('tab')).toBe(false);

    await slotsTab(page).click();
    await expect.poll(() => query(page).get('tab')).toBe('slots');
    await page.reload();
    await expect(slotsTab(page)).toHaveClass(/active/, { timeout: 30_000 });

    await page.goBack();
    await expect(requestsTab(page)).toHaveClass(/active/);
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
