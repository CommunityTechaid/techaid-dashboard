/**
 * A slow, OLDER DataTables response must never overwrite a newer one.
 *
 * WHY THIS EXISTS
 *   Every server-side DataTables component renders its rows from `this.entities`, assigned
 *   in the ajax callback's `.then()`. DataTables' own `draw` counter discards stale draws for
 *   its bookkeeping (info label, paging) — but the component assigned `this.entities` from
 *   EVERY response, so whichever landed last won. Type a search, then change it while the
 *   first query is still in flight: if the first response is slower, the table showed its
 *   rows under the second term. Found 2026-09-23 while de-flaking device-intake, where a
 *   clear-then-search raced the same way against live UAT.
 *
 *   Fixed with `LatestDraw` (src/app/shared/utils/latest-draw.ts): each ajax call records
 *   a token, and a response whose token is older than the newest started one is
 *   dropped before it touches component state. (Our own counter, not DataTables' draw.)
 *
 * HOW
 *   The GraphQL stub delays the response for the term SLOW by 2.5s and answers FAST at
 *   once. Search SLOW, then FAST while SLOW is still pending; after SLOW has landed, only
 *   FAST's row may be on screen. Covers three components with different query shapes.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { test, expect, Page, Route } from '@playwright/test';

const SLOW_MS = 2_500;

interface TableCase {
  name: string;
  route: string;
  tableId: string;
  operation: string;
  connection: string;
  row: (label: string, id: number) => Record<string, unknown>;
}

const CASES: TableCase[] = [
  {
    name: 'kit-index',
    route: '/dashboard/devices',
    tableId: 'kit-index',
    operation: 'findAllKits',
    connection: 'kitsConnection',
    row: (label, id) => ({
      id, make: 'Dell', model: label, age: 1, type: 'LAPTOP', status: 'DONATION_NEW',
      location: 'Brixton store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
      lotId: null, donor: null, deviceRequest: null,
    }),
  },
  {
    name: 'device-request-index',
    route: '/dashboard/device-requests',
    tableId: 'device-request-index',
    operation: 'findAllDeviceRequests',
    connection: 'deviceRequestConnection',
    row: (label, id) => ({
      id, status: 'NEW', clientRef: label, borough: '',
      deviceRequestItems: { phones: 0, tablets: 0, laptops: 0, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
      kits: [],
      referringOrganisationContact: { id: 1, fullName: 'Referee', referringOrganisation: { id: 1, name: 'Org' } },
      isPrepped: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }),
  },
  {
    name: 'referring-organisation-index',
    route: '/dashboard/referring-organisations',
    tableId: 'referring-org-index',
    operation: 'findAllReferringOrgs',
    connection: 'referringOrganisationsConnection',
    row: (label, id) => ({
      id, phoneNumber: '07700900000', name: label, website: '', requestCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false,
    }),
  },
];

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, c: TableCase): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (!body.includes(c.operation)) return fulfill(route, {});

    const term = String(JSON.parse(body).variables?.term ?? '');
    const page1 = (label: string, id: number) => ({
      [c.connection]: { totalElements: 1, number: 0, content: [c.row(label, id)] },
    });
    if (term === 'SLOW') {
      await new Promise(r => setTimeout(r, SLOW_MS));
      return fulfill(route, page1('STALE-SLOW-ROW', 2)).catch(() => {});
    }
    if (term === 'FAST') return fulfill(route, page1('FRESH-FAST-ROW', 3));
    return fulfill(route, page1('INITIAL-ROW', 1));
  });
}

test.describe('stale DataTables responses are dropped @mocked', () => {
  for (const c of CASES) {
    test(`${c.name}: a slow earlier search cannot overwrite a newer one`, async ({ page }) => {
      test.setTimeout(60_000);
      await installMocks(page, c);
      await page.goto(c.route);
      const rows = page.locator(`#${c.tableId} tbody tr`);
      await expect(rows.filter({ hasText: 'INITIAL-ROW' })).toBeVisible({ timeout: 30_000 });

      const search = page.locator(`input[aria-controls="${c.tableId}"]`);
      const slowSent = page.waitForRequest(r => (r.postData() ?? '').includes('"term":"SLOW"'));
      await search.fill('SLOW');
      await search.press('Enter');
      await slowSent;

      await search.fill('FAST');
      await search.press('Enter');
      await expect(rows.filter({ hasText: 'FRESH-FAST-ROW' })).toBeVisible({ timeout: 10_000 });

      // Let the slow, older response land, then give Angular a beat to (wrongly) repaint.
      await page.waitForTimeout(SLOW_MS + 1_000);
      await expect(rows.filter({ hasText: 'STALE-SLOW-ROW' })).toHaveCount(0);
      await expect(rows.filter({ hasText: 'FRESH-FAST-ROW' })).toBeVisible();
    });
  }
});
