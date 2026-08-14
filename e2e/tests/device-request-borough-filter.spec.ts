/**
 * Device Requests admin list — Borough column + borough filter (issue #180).
 *
 * Three behaviours get dedicated coverage because each has a silent-failure mode:
 *  - a blank `borough` (every request created before the ward-lookup step existed, and
 *    everything staff create in the admin form) must render as "Not recorded", not an
 *    empty cell that reads like a rendering fault;
 *  - the "Not recorded" filter option is a UI-only sentinel (`__not_recorded__`) that must
 *    never reach the API — it is translated into an `OR` of `_in: ['']` / `_is_null: true`
 *    so both legacy shapes of "no borough" are matched;
 *  - adding a column shifts every DataTables column index after it, so a DataTables state
 *    saved before this change (9 columns) must be discarded rather than silently corrupting
 *    the sort/visibility of the now-10-column table — the classic "broken for me, fine in
 *    incognito" bug.
 *
 * Mirrors feature-flags-interpretability.spec.ts / borough-availability-admin.spec.ts: every
 * GraphQL operation is page.route-stubbed by inspecting the raw request body, and the Auth0
 * cache is written directly.
 *
 * @mocked — no bearer token needed; runs under `npm run e2e:fast`.
 */
import { test, expect, Page, Route } from '@playwright/test';
import { authenticateWithPermissions as seedAuth0Cache } from '../helpers/auth0-cache';

const INDEX_PATH = '/dashboard/device-requests';
const TABLE_ID = 'device-request-index';
const FILTER_STORAGE_KEY = `deviceRequestFilters-${TABLE_ID}`;
const NOT_RECORDED_SENTINEL = '__not_recorded__';

/**
 * Auth0 cache + a pinned device-request filter with `is_sales` present-but-empty, so the
 * badge/predicate assertions start from a known baseline rather than whatever default filter
 * the component seeds (`is_sales: [false]`, which — being present in the model — would
 * otherwise show up as a spurious "1" on the Filter badge and an `isSales` predicate on
 * every captured request). `is_sales: []` is present, so formly does not fall back to its
 * `defaultValue`, and an empty array contributes nothing to filterCount.
 *
 * NB: page.addInitScript re-runs on every navigation, including reload — do not use this for
 * a test that reloads after applying a filter via the UI, or the reload will stomp the
 * real filter straight back to this pinned value. Use `authenticateUnpinned` there instead.
 */
async function authenticate(page: Page): Promise<void> {
  await seedAuth0Cache(page, [], {
    subject: 'auth0|e2e-borough-filter',
    localStorage: { [FILTER_STORAGE_KEY]: '{"is_sales":[]}' },
  });
}

/** Auth0 cache with no pinned filter storage — safe to use across a reload. */
async function authenticateUnpinned(page: Page): Promise<void> {
  await seedAuth0Cache(page, [], { subject: 'auth0|e2e-borough-filter-reload' });
}

function deviceRequestRow(overrides: Partial<{
  id: number;
  status: string;
  clientRef: string;
  borough: string;
  contactId: number;
  contactName: string;
  orgId: number;
  orgName: string;
}>) {
  const id = overrides.id ?? 1;
  return {
    id,
    status: overrides.status ?? 'NEW',
    clientRef: overrides.clientRef ?? `CR-${id}`,
    borough: overrides.borough ?? '',
    deviceRequestItems: {
      phones: 0, tablets: 0, laptops: 0, allInOnes: 0,
      desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0,
    },
    kits: [],
    referringOrganisationContact: {
      id: overrides.contactId ?? id + 1000,
      fullName: overrides.contactName ?? `Referee ${id}`,
      referringOrganisation: {
        id: overrides.orgId ?? id + 2000,
        name: overrides.orgName ?? `Org ${id}`,
      },
    },
    isPrepped: false,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
  };
}

const ROWS = [
  deviceRequestRow({ id: 301, clientRef: 'CR-TOWERHAMLETS', borough: 'Tower Hamlets' }),
  deviceRequestRow({ id: 302, clientRef: 'CR-LAMBETH', borough: 'Lambeth' }),
  deviceRequestRow({ id: 303, clientRef: 'CR-BLANK', borough: '' }),
];

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Every findAllDeviceRequests request body lands here, for "what did it ask for?" assertions. */
async function installMocks(page: Page, capturedRequests: string[]): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';

    if (body.includes('findAllDeviceRequests')) {
      capturedRequests.push(body);
      return fulfillJson(route, {
        data: { deviceRequestConnection: { totalElements: ROWS.length, content: ROWS } },
      });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

function row(page: Page, clientRef: string) {
  return page.locator(`#${TABLE_ID} tbody tr`, { hasText: clientRef });
}

function boroughCell(page: Page, clientRef: string) {
  return row(page, clientRef).locator('td').nth(4);
}

async function openFilterModal(page: Page): Promise<void> {
  await page.locator('a.btn-info', { hasText: /Filter/i }).click();
  await expect(page.locator('.modal-title', { hasText: 'Device Request Filters' })).toBeVisible({ timeout: 5_000 });
}

async function applyFilterModal(page: Page, capturedRequests: string[]): Promise<any> {
  const before = capturedRequests.length;
  await page.locator('.modal-footer button.btn-primary', { hasText: /Filter/i }).click();
  await expect.poll(() => capturedRequests.length).toBeGreaterThan(before);
  return JSON.parse(capturedRequests[capturedRequests.length - 1]);
}

test.describe('device request borough column + filter @mocked', () => {
  test('the Borough column renders, with values for populated rows', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);

    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`#${TABLE_ID} thead th`).nth(4)).toHaveText('Borough');
    await expect(boroughCell(page, 'CR-TOWERHAMLETS')).toHaveText('Tower Hamlets');
    await expect(boroughCell(page, 'CR-LAMBETH')).toHaveText('Lambeth');
  });

  test('a blank borough is labelled "Not recorded", not left empty', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);

    await expect(row(page, 'CR-BLANK')).toBeVisible({ timeout: 30_000 });
    await expect(boroughCell(page, 'CR-BLANK')).toHaveText('Not recorded');
  });

  test('filtering by one borough emits a plain _in predicate, no OR', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await openFilterModal(page);
    await page.getByLabel('Tower Hamlets').check();
    const parsed = await applyFilterModal(page, capturedRequests);

    const filter = parsed.variables?.filter ?? {};
    expect(filter.borough).toEqual({ _in: ['Tower Hamlets'] });
    expect(filter.OR).toBeUndefined();
  });

  test('filtering by two boroughs sends both in a single _in', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await openFilterModal(page);
    await page.getByLabel('Lambeth').check();
    await page.getByLabel('Tower Hamlets').check();
    const parsed = await applyFilterModal(page, capturedRequests);

    const filter = parsed.variables?.filter ?? {};
    expect(filter.borough?._in?.slice().sort()).toEqual(['Lambeth', 'Tower Hamlets']);
    expect(filter.OR).toBeUndefined();
  });

  test('"Not recorded" alone emits the null-or-blank OR, and the sentinel never reaches the API', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await openFilterModal(page);
    await page.getByLabel('Not recorded').check();
    const raw = (async () => {
      const before = capturedRequests.length;
      await page.locator('.modal-footer button.btn-primary', { hasText: /Filter/i }).click();
      await expect.poll(() => capturedRequests.length).toBeGreaterThan(before);
      return capturedRequests[capturedRequests.length - 1];
    })();
    const body = await raw;
    expect(body).not.toContain(NOT_RECORDED_SENTINEL);

    const parsed = JSON.parse(body);
    const filter = parsed.variables?.filter ?? {};
    expect(filter.borough).toBeUndefined();
    expect(filter.OR).toContainEqual({ borough: { _in: [''] } });
    expect(filter.OR).toContainEqual({ borough: { _is_null: true } });
  });

  test('a named borough plus "Not recorded" ORs the named _in with both blank alternatives', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await openFilterModal(page);
    await page.getByLabel('Lambeth').check();
    await page.getByLabel('Not recorded').check();
    const parsed = await applyFilterModal(page, capturedRequests);

    const filter = parsed.variables?.filter ?? {};
    expect(filter.borough).toBeUndefined();
    expect(filter.OR).toContainEqual({ borough: { _in: ['Lambeth'] } });
    expect(filter.OR).toContainEqual({ borough: { _in: [''] } });
    expect(filter.OR).toContainEqual({ borough: { _is_null: true } });
  });

  test('the Filter badge count reflects the number of ticked boroughs', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('a.btn-info .badge-danger')).toHaveCount(0);

    await openFilterModal(page);
    await page.getByLabel('Lambeth').check();
    await page.getByLabel('Tower Hamlets').check();
    await applyFilterModal(page, capturedRequests);

    await expect(page.locator('a.btn-info .badge-danger')).toHaveText('2');
  });

  test('the filter survives a reload, restored from localStorage', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticateUnpinned(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    await openFilterModal(page);
    await page.getByLabel('Tower Hamlets').check();
    await applyFilterModal(page, capturedRequests);

    capturedRequests.length = 0;
    await page.reload();
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => capturedRequests.length).toBeGreaterThan(0);

    const parsed = JSON.parse(capturedRequests[capturedRequests.length - 1]);
    const filter = parsed.variables?.filter ?? {};
    expect(filter.borough).toEqual({ _in: ['Tower Hamlets'] });
  });

  test('a stale saved DataTables state (pre-borough 9 columns) does not break the table', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedRequests: string[] = [];
    await authenticate(page);
    await installMocks(page, capturedRequests);
    await page.goto(INDEX_PATH);
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });

    // Discover the exact key DataTables wrote its state under, rather than assuming it.
    await page.waitForFunction(
      () => Object.keys(localStorage).some((k) => k.startsWith('DataTables_')),
      { timeout: 10_000 },
    );
    const stateKey = await page.evaluate(
      () => Object.keys(localStorage).find((k) => k.startsWith('DataTables_')) ?? null,
    );
    expect(stateKey, 'expected DataTables to have saved its state to localStorage').toBeTruthy();
    expect(stateKey).toBe(`DataTables_${TABLE_ID}_${INDEX_PATH}`);

    // Downgrade the saved state to the pre-#180 column count (9) — the shape a browser that
    // last visited before the Borough column shipped would still be carrying.
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key as string) ?? '{}');
      if (Array.isArray(state.columns)) {
        state.columns = state.columns.slice(0, 9);
      }
      localStorage.setItem(key as string, JSON.stringify(state));
    }, stateKey);

    await page.reload();
    await expect(row(page, 'CR-TOWERHAMLETS')).toBeVisible({ timeout: 30_000 });
    await expect(row(page, 'CR-LAMBETH')).toBeVisible();
    await expect(row(page, 'CR-BLANK')).toBeVisible();
    await expect(page.locator(`#${TABLE_ID} thead th`).nth(4)).toHaveText('Borough');
  });
});
