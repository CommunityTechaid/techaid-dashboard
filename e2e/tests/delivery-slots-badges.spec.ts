/**
 * Mocked coverage for the admin "Delivery Slots" tab booking badges
 * (delivery-slots.component.html). Each booking row cross-references the CTA
 * reference against device requests server-side and the tab flags mismatches:
 *   - matchedRequestId null              → amber "unmatched" badge (title explains it).
 *   - matched + matchedRequestOpen true  → no badge (healthy).
 *   - matched + matchedRequestOpen false → grey "closed" badge whose title names the
 *                                          matched request id and status.
 *
 * The tab lives on the Distributions & Deliveries page and loads via Apollo
 * (deliverySlotsAdmin, whose deliveryBookingsAdmin field carries the rows). Apollo
 * POSTs to /graphql so page.route catches it. The "Delivery Slots" tab renders because
 * deliveryBookingVisibility().visible is true under uat-local (production=false).
 *
 * @mocked — no token (fake JWT satisfies AuthGuard), all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const WINDOW = { id: 'win-1', name: 'Morning window' };

/** Three bookings in one slot: unmatched, matched-open, matched-closed. */
const BOOKINGS = [
  {
    id: 'bk-unmatched',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Alice',
    surname: 'Unmatched',
    email: 'alice@example.org',
    phone: '07700900001',
    address: '1 A Street',
    accessNotes: '',
    ctaReference: 9001,
    createdAt: '2026-07-18T09:00:00Z',
    matchedRequestId: null,
    matchedRequestStatus: null,
    matchedRequestOpen: null,
  },
  {
    id: 'bk-open',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Bob',
    surname: 'Openmatch',
    email: 'bob@example.org',
    phone: '07700900002',
    address: '2 B Street',
    accessNotes: '',
    ctaReference: 9002,
    createdAt: '2026-07-18T09:05:00Z',
    matchedRequestId: '5551',
    matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
    matchedRequestOpen: true,
  },
  {
    id: 'bk-closed',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Carol',
    surname: 'Closedmatch',
    email: 'carol@example.org',
    phone: '07700900003',
    address: '3 C Street',
    accessNotes: '',
    ctaReference: 9003,
    createdAt: '2026-07-18T09:10:00Z',
    matchedRequestId: '5552',
    matchedRequestStatus: 'REQUEST_COMPLETED',
    matchedRequestOpen: false,
  },
  {
    id: 'bk-outofarea',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Dana',
    surname: 'Outsider',
    email: 'dana@example.org',
    phone: '07700900004',
    address: '1 Whitehall\nLondon\nSW1A 2AA',
    accessNotes: '',
    ctaReference: 9004,
    createdAt: '2026-07-18T09:15:00Z',
    matchedRequestId: '5553',
    matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
    matchedRequestOpen: true,
  },
  {
    id: 'bk-supported',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Erin',
    surname: 'Local',
    email: 'erin@example.org',
    phone: '07700900005',
    address: '10 Coldharbour Lane\nLondon\nSW9 7AA',
    accessNotes: '',
    ctaReference: 9005,
    createdAt: '2026-07-18T09:20:00Z',
    matchedRequestId: '5554',
    matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
    matchedRequestOpen: true,
  },
];

const SLOTS_DATA = {
  deliveryConfig: {
    id: 'cfg-1',
    enabled: true,
    daysOfWeek: '1,2,3',
    leadTimeDays: 1,
    advanceDays: 4,
    updatedAt: '2026-07-18T00:00:00Z',
  },
  deliveryWindowsAdmin: [
    { id: 'win-1', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm', icon: '☀️', capacity: 5, sortOrder: 1, active: true },
  ],
  deliveryBlockedDates: [],
  deliveryBookingsAdmin: BOOKINGS,
};

async function installSlotsMocks(page: Page): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
      return fulfillJson(route, { data: SLOTS_DATA });
    }
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    }
    if (body.includes('findAllDeviceRequests')) {
      return fulfillJson(route, { data: { deviceRequestConnection: { totalElements: 0, content: [] } } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

test.describe('delivery-slots booking badges @mocked', () => {
  test('flags unmatched and closed bookings and leaves healthy ones unbadged', async ({ page }) => {
    test.setTimeout(60_000);
    await installSlotsMocks(page);

    await page.goto('/dashboard/distributions-and-deliveries');
    // Reveal the Delivery Slots tab.
    await page.getByRole('link', { name: 'Delivery Slots' }).click();

    // Each row is located by the booker's name; assert its badge state.
    const unmatchedRow = page.locator('tr', { hasText: 'Alice Unmatched' });
    const openRow = page.locator('tr', { hasText: 'Bob Openmatch' });
    const closedRow = page.locator('tr', { hasText: 'Carol Closedmatch' });

    // Unmatched → amber badge with explanatory tooltip.
    const unmatchedBadge = unmatchedRow.locator('span.badge-warning');
    await expect(unmatchedBadge).toBeVisible({ timeout: 15_000 });
    await expect(unmatchedBadge).toHaveText('unmatched');
    await expect(unmatchedBadge).toHaveAttribute('title', 'No device request found with this id');

    // Matched + open → no badge in the CTA-ref cell.
    await expect(openRow.locator('span.badge-warning')).toHaveCount(0);
    await expect(openRow.locator('span.badge-secondary')).toHaveCount(0);

    // Matched + closed → grey badge naming the matched request id and status.
    const closedBadge = closedRow.locator('span.badge-secondary');
    await expect(closedBadge).toBeVisible();
    await expect(closedBadge).toHaveText('closed');
    await expect(closedBadge).toHaveAttribute(
      'title',
      'Matched device request #5552 (REQUEST_COMPLETED)',
    );
  });

  test('flags a booking whose address postcode is outside the supported boroughs, and not a supported one', async ({ page }) => {
    // Part 2: resolved client-side from the address's postcode via WardLookupService — the
    // real bundled ward-lookup asset is used (a same-origin static file, not a /graphql call),
    // not stubbed. SW1A 2AA (Westminster) isn't in the table at all; SW9 7AA (Lambeth) is.
    test.setTimeout(60_000);
    await installSlotsMocks(page);

    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();

    const outOfAreaRow = page.locator('tr', { hasText: 'Dana Outsider' });
    const supportedRow = page.locator('tr', { hasText: 'Erin Local' });
    const unmatchedRow = page.locator('tr', { hasText: 'Alice Unmatched' });

    const outOfAreaBadge = outOfAreaRow.locator('span.badge-danger');
    await expect(outOfAreaBadge).toBeVisible({ timeout: 15_000 });
    await expect(outOfAreaBadge).toHaveText('outside delivery area');
    await expect(outOfAreaBadge).toHaveAttribute(
      'title',
      "This postcode doesn't resolve to one of our currently supported delivery boroughs",
    );

    await expect(supportedRow.locator('span.badge-danger')).toHaveCount(0);
    // A booking with no extractable postcode in its address must stay silent, not flagged.
    await expect(unmatchedRow.locator('span.badge-danger')).toHaveCount(0);
  });
});
