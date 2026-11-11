/**
 * Live-UAT regression pass over EVERY list/index table in the dashboard.
 *
 * WHY: #113 replaces jQuery DataTables with a native Angular table (`cta-table`), a group of
 * pages at a time (docs/native-tables-plan.md), and each PR merges on a green MOCKED run. This
 * spec is the check against the deployed build and real UAT data that nobody does by hand. It is
 * implementation-agnostic on purpose: the native shell keeps DataTables' markup and class names
 * (`<id>_wrapper`, `.dt-info`, `.dt-search input`, `.dt-length select`,
 * `.dt-paging button.page-link.next|previous`, `aria-sort`), so the same spec must pass BEFORE and
 * AFTER a page migrates.
 *
 * Coverage (one test per table, desktop width; phone width is covered for the four main lists by
 * uat-release-pass.spec.ts): all 18 server-side paged tables, the client-side dashboard status
 * table, the dashboard's post list, and the two audit lists. Tables on detail pages are reached
 * by picking real records from the parent list (the first few rows are scanned, preferring a
 * record whose child table has more than one page).
 *
 * Per table: loads with rows (else the test is skipped with a reason), info line, page length,
 * paging, sort (default header flips, flips back and `aria-sort` is NEVER removed (#336), another
 * column's first click is ascending), search on Enter (no match gives 0 rows, clearing restores
 * the total), saved state across a reload, no CSP violations, no GraphQL `errors`, no uncaught
 * page errors. A control a table does not have (no search box, no length menu, ...) skips that
 * step and says so in the test annotations. Extras: kit-id-list paste (devices) and the week
 * quick filter plus "hidden" note (distributions and deliveries).
 *
 * STRICTLY READ-ONLY: no form is submitted and no button that writes is clicked. A network guard
 * aborts any GraphQL request that starts with `mutation` and FAILS the test.
 *
 * Run (deployed UAT front end, real CSP, production bundle; needs a real token, see
 * e2e/save-token.mjs):
 *   npx playwright test --config playwright.config.uat.ts uat-list-pages-live
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { getBearerToken } from '../helpers/graphql';

function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') {
    return 'CI fake token: the live list pass needs a real UAT token';
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) {
      return 'UAT bearer token expired: run e2e/save-token.mjs with a fresh one';
    }
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

const tokenProblem = uatTokenUnavailable();

// ── Guards ──────────────────────────────────────────────────────────────────────────────────

interface Guards {
  csp: string[];
  graphqlErrors: string[];
  pageErrors: string[];
  mutations: string[];
}

/** True if a GraphQL request body (single or batched) contains a mutation operation. */
function bodyHasMutation(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const ops = Array.isArray(parsed) ? parsed : [parsed];
    return ops.some(op => /^\s*mutation\b/.test(String(op?.query ?? '')));
  } catch {
    return /^\s*mutation\b/.test(body) || /"query"\s*:\s*"\s*mutation\b/.test(body);
  }
}

async function installGuards(page: Page): Promise<Guards> {
  const g: Guards = { csp: [], graphqlErrors: [], pageErrors: [], mutations: [] };
  page.on('console', msg => {
    if (/Content Security Policy|EvalError|unsafe-eval/i.test(msg.text())) {
      g.csp.push(msg.text());
    }
  });
  page.on('pageerror', err => g.pageErrors.push(String(err)));
  page.on('response', async res => {
    if (!res.url().endsWith('/graphql')) return;
    try {
      const body = await res.json();
      const payloads = Array.isArray(body) ? body : [body];
      for (const p of payloads) {
        if (p?.errors?.length) {
          g.graphqlErrors.push(p.errors.map((e: { message?: string }) => e?.message ?? String(e)).join(' | '));
        }
      }
    } catch {
      /* not JSON or the page navigated away mid-response */
    }
  });
  await page.route('**/graphql', route => {
    if (bodyHasMutation(route.request().postData() ?? '')) {
      g.mutations.push((route.request().postData() ?? '').slice(0, 200));
      return route.abort();
    }
    return route.fallback();
  });
  return g;
}

function expectClean(g: Guards) {
  expect(g.mutations, 'GraphQL mutations attempted (this spec is read-only)').toEqual([]);
  expect(g.csp, 'CSP violations').toEqual([]);
  expect(g.graphqlErrors, 'GraphQL errors in /graphql responses').toEqual([]);
  expect(g.pageErrors, 'uncaught page errors').toEqual([]);
}

// ── Table helpers ───────────────────────────────────────────────────────────────────────────

const INFO = /Showing ([\d,]+) to ([\d,]+) of ([\d,]+) entr(?:y|ies)/;
const num = (s: string) => Number(s.replace(/,/g, ''));
const fmt = (n: number) => n.toLocaleString('en-GB');

interface Handle {
  wrapper: Locator;
  /** Called after page.reload(): re-selects the tab on detail pages. */
  afterReload: () => Promise<void>;
}
type Located = Handle | { skip: string };

interface Table {
  name: string;
  locate: (page: Page) => Promise<Located>;
  extras?: 'devices' | 'distributions';
  /** The table does not save its state (client-side dashboard table: no stateSave). */
  noSavedState?: boolean;
  /** The search box is wired but the table's query takes no filter (a known gap, see exerciseTable). */
  searchIgnored?: boolean;
}

const rowsOf = (w: Locator) =>
  w.locator('table tbody tr:not(:has(td.dt-empty, td.no-data-available))');
const emptyOf = (w: Locator) => w.locator('table tbody td.dt-empty, table tbody td.no-data-available');
const infoOf = (w: Locator) => w.locator('.dt-info');
const lengthOf = (w: Locator) => w.locator('.dt-length select');
const searchOf = (w: Locator) => w.locator('.dt-search input');
const headersOf = (w: Locator) => w.locator('table thead th');

/** Waits for the table's request to finish (the processing overlay, where there is one). */
async function settled(w: Locator, timeout = 60_000) {
  await expect(w.locator('.dt-processing')).toBeHidden({ timeout });
}

/**
 * Waits until the table shows data rows, or a placeholder has been showing after the request
 * finished. Returns the data row count (0 = genuinely empty).
 */
async function waitForRows(w: Locator, maxMs: number): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const rows = await rowsOf(w).count();
    if (rows > 0) return rows;
    const empty = await emptyOf(w).count();
    const processing = await w.locator('.dt-processing').isVisible().catch(() => false);
    if (empty > 0 && !processing && Date.now() - start > 4_000) return 0;
    await w.page().waitForTimeout(400);
  }
  return rowsOf(w).count();
}

async function totalOf(w: Locator): Promise<number> {
  if (await infoOf(w).count()) {
    const m = ((await infoOf(w).first().textContent()) ?? '').match(INFO);
    if (m) return num(m[3]);
  }
  return rowsOf(w).count();
}

/** First header carrying aria-sort, with its direction. */
async function sortedHeader(w: Locator): Promise<{ index: number; dir: string } | null> {
  const n = await headersOf(w).count();
  for (let i = 0; i < n; i++) {
    const dir = await headersOf(w).nth(i).getAttribute('aria-sort');
    if (dir === 'ascending' || dir === 'descending') return { index: i, dir };
  }
  return null;
}

// DataTables 3 puts a .dt-column-order on every header; only sortable ones get dt-orderable-*.
const isSortable = async (th: Locator) => /dt-orderable-(asc|desc)/.test((await th.getAttribute('class')) ?? '');

// ── Locating tables ─────────────────────────────────────────────────────────────────────────

/** A table with a fixed route and id. */
function listTable(
  name: string,
  path: string,
  id: string,
  extras?: Table['extras'],
  noSavedState = false,
): Table {
  return {
    name,
    extras,
    noSavedState,
    async locate(page) {
      await page.goto(path);
      return { wrapper: page.locator(`[id="${id}_wrapper"]`), afterReload: async () => undefined };
    },
  };
}

/** A DataTables or native shell inside the open tab, or (audit lists, now plain tables) the tab itself. */
const activePane = (page: Page, plain = false) =>
  page.locator(plain ? '.tab-pane.active' : '.tab-pane.active .dt-container').first();

/**
 * A table inside a tab of a detail page. Scans the first rows of the parent list for a record
 * whose child table has data (stopping at one with more than a page of it), then opens it.
 */
function detailTable(
  name: string,
  opts: { listPath: string; segment: string; tab?: RegExp; wantRows?: number; searchIgnored?: boolean; plain?: boolean },
): Table {
  const { listPath, segment, tab, wantRows = 6, searchIgnored, plain } = opts;
  const openTab = async (page: Page) => {
    if (tab) await page.getByRole('tab', { name: tab }).click();
  };
  return {
    name,
    searchIgnored,
    async locate(page) {
      await page.goto(listPath);
      // Record links only (the page also has static links such as /dashboard/devices/update-scanner),
      // so poll until rows have rendered.
      // Ids are numeric, except users and roles (Auth0 ids such as auth0%7C... and rol_...).
      const recordHref = new RegExp(`^/dashboard/${segment}/(?!update-scanner$)[^/\\s]+$`);
      const collect = async () => [
        ...new Set(
          (
            await page
              .locator(`a[href^="/dashboard/${segment}/"]`)
              .evaluateAll(as => as.map(a => a.getAttribute('href') ?? ''))
          ).filter(h => recordHref.test(h)),
        ),
      ];
      await expect.poll(async () => (await collect()).length, { timeout: 120_000 }).toBeGreaterThan(0).catch(() => undefined);
      const hrefs = (await collect()).slice(0, 10);
      if (!hrefs.length) return { skip: `no ${segment} rows to open on UAT` };

      let best = { href: '', total: 0 };
      let last = '';
      for (const href of hrefs) {
        await page.goto(href);
        last = href;
        await openTab(page);
        const wrapper = activePane(page, plain);
        await wrapper.waitFor({ timeout: 20_000 }).catch(() => undefined);
        if (!(await wrapper.count())) continue;
        const rows = await waitForRows(wrapper, 20_000);
        const total = rows > 0 ? await totalOf(wrapper) : 0;
        if (total > best.total) best = { href, total };
        if (total >= wantRows) break;
      }
      if (best.total === 0) {
        return { skip: `none of the first ${hrefs.length} ${segment} on UAT has rows in this table` };
      }
      if (best.href !== last) {
        await page.goto(best.href);
        await openTab(page);
      }
      return { wrapper: activePane(page, plain), afterReload: () => openTab(page) };
    },
  };
}

const TABLES: Table[] = [
  // Top-level server-side lists
  listTable('devices (kit-index)', '/dashboard/devices', 'kit-index', 'devices'),
  listTable('device requests (device-request-index)', '/dashboard/device-requests', 'device-request-index'),
  listTable('organisations (referring-organisation-index)', '/dashboard/referring-organisations', 'referring-org-index'),
  listTable('referees (referring-organisation-contact-index)', '/dashboard/referring-organisation-contacts', 'referring-org-contact-index'),
  listTable('donors (donor-index)', '/dashboard/donors', 'donor-index'),
  listTable('donor parents (donor-parent-index)', '/dashboard/donor-parents', 'donor-parent-index'),
  listTable('posts (post-index)', '/dashboard/posts', 'post-index'),
  listTable('roles (role-index)', '/dashboard/roles', 'role-index'),
  listTable('users (user-index)', '/dashboard/users', 'user-index'),
  listTable('distributions and deliveries', '/dashboard/distributions-and-deliveries', 'distributions-and-deliveries-index', 'distributions'),
  // Dashboard: the client-side status table (its id is a duplicate "donor-index") and the post list
  listTable('dashboard status table (dashboard-index, client-side)', '/', 'status-count', undefined, true),
  listTable('dashboard post list (post-index, dashboard copy)', '/', 'post-index-dashboard'),
  // Child tabs on detail pages
  detailTable('role users (role-users)', { listPath: '/dashboard/roles', segment: 'roles', tab: /^Users$/, searchIgnored: true }),
  detailTable('role permissions (role-permissions)', { listPath: '/dashboard/roles', segment: 'roles', tab: /^Permissions$/, searchIgnored: true }),
  detailTable('user roles (user-roles)', { listPath: '/dashboard/users', segment: 'users', tab: /^Roles$/, searchIgnored: true }),
  detailTable('user permissions (user-permissions)', { listPath: '/dashboard/users', segment: 'users', tab: /^Permissions$/, searchIgnored: true }),
  detailTable('organisation referees (referring-organisation-contact-component)', {
    listPath: '/dashboard/referring-organisations', segment: 'referring-organisations', tab: /^Referees$/,
  }),
  detailTable('organisation device requests (device-request-component)', {
    listPath: '/dashboard/referring-organisations', segment: 'referring-organisations', tab: /^Device Requests$/,
  }),
  detailTable('donor parent donors (donor-component)', {
    listPath: '/dashboard/donor-parents', segment: 'donor-parents', tab: /^Individual Donors$/,
  }),
  detailTable('donor devices (kit-component)', { listPath: '/dashboard/donors', segment: 'donors', tab: /^Devices$/ }),
  // Audit lists (loader only: no paging, sorting or search)
  detailTable('kit audit (kit-audit-component)', { listPath: '/dashboard/devices', segment: 'devices', tab: /^Audit Table$/, wantRows: 1, plain: true }),
  detailTable('device request audit (device-request-audit-component)', {
    listPath: '/dashboard/device-requests', segment: 'device-requests', tab: /^Audit Table$/, wantRows: 1, plain: true,
  }),
];

// ── The checks ──────────────────────────────────────────────────────────────────────────────

function note(type: string, description: string) {
  test.info().annotations.push({ type, description });
}

async function exerciseTable(page: Page, table: Table, h: Handle) {
  const { wrapper } = h;
  const rows = rowsOf(wrapper);
  const info = infoOf(wrapper);

  // ── loaded ────────────────────────────────────────────────────────────────────────────────
  const first = await waitForRows(wrapper, 120_000);
  if (first === 0) {
    test.skip(true, `${table.name}: UAT has no rows for this table (placeholder shown after load)`);
    return;
  }
  await settled(wrapper);
  const hasInfo = (await info.count()) > 0; // read only once the table has rendered
  const total = await totalOf(wrapper);
  expect(total, 'row total').toBeGreaterThan(0);

  // ── info line ─────────────────────────────────────────────────────────────────────────────
  const checkInfo = async (label: string) => {
    if (!hasInfo) return;
    const text = ((await info.first().textContent()) ?? '').trim();
    const m = text.match(INFO);
    expect(m, `${label}: info line "${text}" should read "Showing x to y of z entries"`).not.toBeNull();
    const [from, to, of] = [num(m![1]), num(m![2]), num(m![3])];
    expect(from, `${label}: info from`).toBeGreaterThanOrEqual(1);
    expect(to, `${label}: info to`).toBeLessThanOrEqual(of);
    expect(await rows.count(), `${label}: row count matches "${text}"`).toBe(to - from + 1);
  };
  if (hasInfo) {
    await expect(info).toContainText(/Showing 1 to/, { timeout: 60_000 });
    await checkInfo('on load');
  } else {
    note('skipped step', 'info line: table has no .dt-info');
  }

  // ── page length ───────────────────────────────────────────────────────────────────────────
  const lengthMenu = lengthOf(wrapper);
  let pageSize = Math.min(await rows.count(), total); // whatever the table shows by default
  if ((await lengthMenu.count()) === 0) {
    note('skipped step', 'page length: table has no length menu');
  } else {
    const options = await lengthMenu.locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value));
    for (const size of ['25', '5']) {
      if (!options.includes(size)) {
        note('skipped step', `page length ${size}: not in this table's menu (${options.join(',')})`);
        continue;
      }
      await lengthMenu.selectOption(size);
      await expect(rows).toHaveCount(Math.min(Number(size), total), { timeout: 60_000 });
      await settled(wrapper);
      await checkInfo(`length ${size}`);
      pageSize = Math.min(Number(size), total);
    }
  }
  const length = (await lengthMenu.count()) ? await lengthMenu.inputValue() : null;

  // ── paging ────────────────────────────────────────────────────────────────────────────────
  const next = wrapper.locator('.dt-paging button.page-link.next');
  const previous = wrapper.locator('.dt-paging button.page-link.previous');
  if (total > pageSize && (await next.count())) {
    const before = await rows.first().innerText();
    await next.scrollIntoViewIfNeeded();
    await next.click();
    if (hasInfo) {
      await expect(info).toContainText(`Showing ${pageSize + 1} to`, { timeout: 60_000 });
    }
    await expect(rows.first()).not.toHaveText(before, { timeout: 60_000, useInnerText: true });
    await settled(wrapper);
    await checkInfo('page 2');
    await previous.click();
    if (hasInfo) await expect(info).toContainText('Showing 1 to', { timeout: 60_000 });
    await expect(rows.first()).toHaveText(before, { timeout: 60_000, useInnerText: true });
    await settled(wrapper);
  } else {
    note('skipped step', `paging: ${total} rows fit on one page of ${pageSize}, or no pager`);
  }

  // ── sort ──────────────────────────────────────────────────────────────────────────────────
  const initial = await sortedHeader(wrapper);
  const headers = headersOf(wrapper);
  let sortedAfter: { index: number; dir: string } | null = initial;
  if (!initial) {
    note('skipped step', 'sort: no header carries aria-sort on load (table is unsorted)');
  } else if (!(await isSortable(headers.nth(initial.index)))) {
    note('skipped step', `sort flip: default-sorted column ${initial.index} is not click-sortable`);
  } else {
    const th = headers.nth(initial.index);
    const flipped = initial.dir === 'descending' ? 'ascending' : 'descending';
    await th.scrollIntoViewIfNeeded();
    await th.click();
    await expect(th, 'first click flips the default sort').toHaveAttribute('aria-sort', flipped, { timeout: 60_000 });
    await settled(wrapper);
    await expect(th, 'aria-sort stays after the response').toHaveAttribute('aria-sort', flipped);
    await th.click();
    await expect(th, 'second click flips back and never clears it (#336)').toHaveAttribute('aria-sort', initial.dir, {
      timeout: 60_000,
    });
    await settled(wrapper);
    await expect(th, 'aria-sort stays after the response').toHaveAttribute('aria-sort', initial.dir);
    await expect(rows.first()).toBeVisible();
    sortedAfter = { index: initial.index, dir: initial.dir };
  }

  // A different column's first click sorts ascending.
  const count = await headers.count();
  let other = -1;
  for (let i = 0; i < count; i++) {
    if (i !== initial?.index && (await isSortable(headers.nth(i)))) {
      other = i;
      break;
    }
  }
  if (other === -1) {
    note('skipped step', 'sort other column: no other sortable header');
  } else {
    const th = headers.nth(other);
    await th.scrollIntoViewIfNeeded();
    await th.click();
    await expect(th, `first click on column ${other} sorts ascending`).toHaveAttribute('aria-sort', 'ascending', {
      timeout: 60_000,
    });
    await settled(wrapper);
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    if (initial) {
      await expect(headers.nth(initial.index), 'previous sort column is released').not.toHaveAttribute(
        'aria-sort',
        /ascending|descending/,
      );
    }
    await expect(rows.first()).toBeVisible();
    sortedAfter = { index: other, dir: 'ascending' };
  }

  // ── search ────────────────────────────────────────────────────────────────────────────────
  const search = searchOf(wrapper);
  if ((await search.count()) === 0) {
    note('skipped step', 'search: table has no search box');
  } else {
    await search.scrollIntoViewIfNeeded();
    await search.fill('zzqxj-no-such-row');
    await search.press('Enter');
    if (table.searchIgnored) {
      // KNOWN GAP, found by this pass on 2026-11-11: these Auth0-backed nested lists send `term`
      // but their GraphQL queries never use it, so the box filters nothing. Pin today's behaviour
      // (the list is unchanged and nothing errors) so a migration cannot make it worse, and so a
      // real fix shows up as this expectation failing.
      note('known gap', 'search box is inert: the query takes no filter, so a no-match term hides nothing');
      await settled(wrapper);
      await page.waitForTimeout(1_500);
      expect(await rows.count(), 'inert search leaves the rows alone').toBeGreaterThan(0);
    } else {
      await expect(rows).toHaveCount(0, { timeout: 60_000 });
      await settled(wrapper);
      if (hasInfo) await expect(info).toContainText('Showing 0 to 0 of 0', { timeout: 60_000 });
    }
    if (table.extras === 'devices') await devicesIdListPaste(wrapper, search);
    await search.fill('');
    await search.press('Enter');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    if (hasInfo) await expect(info).toContainText(`of ${fmt(total)} `, { timeout: 60_000 });
    await settled(wrapper);
  }

  if (table.extras === 'distributions') await distributionsQuickFilter(page, wrapper);

  // ── saved state survives a reload ─────────────────────────────────────────────────────────
  await page.reload();
  await h.afterReload();
  await waitForRows(wrapper, 120_000);
  await settled(wrapper);
  if (table.noSavedState) {
    note('skipped step', 'saved state: this table has no stateSave');
  } else if (length) {
    await expect(lengthMenu, 'page length is restored after a reload').toHaveValue(length);
  } else {
    note('skipped step', 'saved page length: no length menu');
  }
  if (sortedAfter && !table.noSavedState) {
    await expect(headers.nth(sortedAfter.index), 'sort is restored after a reload').toHaveAttribute(
      'aria-sort',
      sortedAfter.dir,
    );
  }
}

/** kit-id-list-bulk-update relies on pasting 2-3 ids into the search box returning exactly them. */
async function devicesIdListPaste(wrapper: Locator, search: Locator) {
  await search.fill('');
  await search.press('Enter');
  const rows = rowsOf(wrapper);
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const n = Math.min(3, await rows.count());
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await rows.nth(i).locator('td').first().innerText()).trim());
  }
  expect(ids.every(id => /^\d+$/.test(id)), `kit ids read from the first column: ${ids.join(',')}`).toBe(true);
  expect(new Set(ids).size, 'distinct ids').toBe(ids.length);
  expect(ids.length, 'need at least 2 devices on the page').toBeGreaterThanOrEqual(2);

  // The box reads an ID list only when it contains a comma (kit-index parseIdList); whitespace
  // around the ids is tolerated, whitespace alone is not a separator.
  const pasted = ids.length === 3 ? `${ids[0]}, ${ids[1]} ,${ids[2]}` : `${ids[0]}, ${ids[1]}`;
  await search.fill(pasted);
  await search.press('Enter');
  await expect
    .poll(async () => (await rowsOf(wrapper).count()), { timeout: 60_000, message: `rows for pasted ids "${pasted}"` })
    .toBe(ids.length);
  await settled(wrapper);
  const got: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    got.push((await rowsOf(wrapper).nth(i).locator('td').first().innerText()).trim());
  }
  expect(got.sort(), 'exactly the pasted kit ids come back').toEqual([...ids].sort());
}

/** Week quick filter and the hidden-requests note; picking a week changes the info line. */
async function distributionsQuickFilter(page: Page, wrapper: Locator) {
  const note$ = page.locator('.dd-hidden-note');
  await expect(note$, 'hidden note is shown with the default filter').toContainText('hidden · change in Filter', {
    timeout: 30_000,
  });
  // Week buttons are the ones with a date-range title (the status buttons carry none).
  const weeks = page.locator('button.btn-sm[title]').filter({ hasText: /\S/ });
  await expect(weeks.first(), 'week quick-filter buttons are present').toBeVisible();
  const info = infoOf(wrapper);
  const before = ((await info.textContent()) ?? '').trim();
  const nWeeks = await weeks.count();
  let changed = false;
  for (let i = 0; i < nWeeks && !changed; i++) {
    await weeks.nth(i).click();
    await settled(wrapper);
    await expect(weeks.nth(i)).toHaveClass(/btn-primary/, { timeout: 30_000 });
    await expect(note$).toContainText('hidden · change in Filter');
    await expect
      .poll(async () => ((await info.textContent()) ?? '').trim(), { timeout: 60_000 })
      .not.toBe('');
    changed = ((await info.textContent()) ?? '').trim() !== before;
  }
  expect(changed, `picking a week changes the info line (was "${before}")`).toBe(true);
  // Restore the default view so the reload check below sees a normal table.
  await page.getByRole('button', { name: /Clear/ }).click();
  await settled(wrapper);
}

// ── Tests ───────────────────────────────────────────────────────────────────────────────────

test.describe('list pages on live UAT (read-only)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');
  test.describe.configure({ mode: 'parallel' });

  for (const table of TABLES) {
    test(table.name, async ({ page }) => {
      test.setTimeout(420_000);
      await page.setViewportSize({ width: 1366, height: 900 });
      const guards = await installGuards(page);

      const located = await table.locate(page);
      if ('skip' in located) {
        test.skip(true, `${table.name}: ${located.skip}`);
        return;
      }
      await exerciseTable(page, table, located);
      expectClean(guards);
    });
  }
});
