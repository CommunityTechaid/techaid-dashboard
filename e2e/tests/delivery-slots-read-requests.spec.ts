/**
 * techaid-server #345 follow-up: `deliveryBookingsAdmin` now accepts `read:requests` (as well as
 * app:admin / read:organisations), so a volunteer who only holds read:requests can use the
 * Distributions & Deliveries -> Delivery Slots tab. This pins the UI side of that: the tab shows,
 * the bookings render, nothing errors, and Delete (write:organisations, #294) stays hidden.
 * A write:organisations control case keeps the "no Delete" assertion from being vacuous.
 *
 * @mocked — all GraphQL stubbed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const json = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const booking = (id: string, first: string, surname: string, ref: number) => ({
  id,
  date: '2026-08-03',
  dayLabel: 'Monday 3 August',
  window: { id: 'w1', name: 'Morning' },
  firstName: first,
  surname,
  email: 'x@example.org',
  phone: '07700900100',
  address: '10 Example Street',
  accessNotes: '',
  ctaReference: ref,
  createdAt: '2026-07-18T09:00:00Z',
  matchedRequestId: null,
  matchedRequestStatus: null,
  matchedRequestOpen: null,
});

const BOOKINGS = [booking('b1', 'Rhea', 'Reader', 9401), booking('b2', 'Remy', 'Reader', 9402)];

async function install(page: Page, seen: { slotsLoads: number; errors: string[] }) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliverySlotsAdmin')) {
      seen.slotsLoads++;
      return json(route, {
        deliveryConfig: {
          id: '1',
          enabled: true,
          daysOfWeek: '1,2,3,4,5',
          leadTimeDays: 1,
          advanceDays: 4,
          updatedAt: '2026-07-01T00:00:00Z',
        },
        deliveryWindowsAdmin: [],
        deliveryBlockedDates: [],
        deliveryBookingsAdmin: BOOKINGS,
      });
    }
    if (body.includes('featureFlagsPublic')) {
      return json(route, { featureFlagsPublic: [{ key: 'delivery-booking', enabled: true }] });
    }
    if (body.includes('findAllDeviceRequests')) {
      return json(route, { deviceRequestConnection: { totalElements: 0, content: [] } });
    }
    if (body.includes('buildInfo')) {
      return json(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    return json(route, {});
  });
  page.on('console', msg => {
    if (msg.type() === 'error') seen.errors.push(msg.text());
  });
  page.on('pageerror', err => seen.errors.push(String(err)));
}

async function openSlots(page: Page) {
  await page.goto('/dashboard/distributions-and-deliveries');
  const tab = page.getByRole('link', { name: /Delivery Slots/ });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByText("Who's booked")).toBeVisible({ timeout: 15_000 });
}

test.describe('Delivery Slots with a read:requests-only login (#345) @mocked', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('read:requests alone: tab shows, bookings render, no errors, no Delete', async ({ page }) => {
    test.setTimeout(60_000);
    const seen = { slotsLoads: 0, errors: [] as string[] };
    await install(page, seen);
    await loginWith(page, ['read:requests']);
    await openSlots(page);

    await expect(page.locator('tr', { hasText: 'Rhea Reader' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tr', { hasText: 'Remy Reader' })).toBeVisible();
    await expect(page.getByTestId('refresh-bookings')).toBeVisible();
    expect(seen.slotsLoads, 'bookings load once, lazily, when the tab opens').toBe(1);

    await expect(page.getByTestId('delete-booking')).toHaveCount(0);
    // The dev server's console is noisy (vite websocket, Apollo missing-field warnings on the slim
    // fixture), so only authorisation/GraphQL failures and uncaught page errors count.
    const relevant = seen.errors.filter(e => /access denied|forbidden|unauthori[sz]ed|apolloerror|graphql error|TypeError/i.test(e) && !/@vite\/client/.test(e));
    expect(relevant, 'no GraphQL/authorisation errors').toEqual([]);
  });

  test('control: adding write:organisations shows Delete on every booking row', async ({ page }) => {
    test.setTimeout(60_000);
    const seen = { slotsLoads: 0, errors: [] as string[] };
    await install(page, seen);
    await loginWith(page, ['read:requests', 'write:organisations']);
    await openSlots(page);

    await expect(page.locator('tr', { hasText: 'Rhea Reader' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('delete-booking')).toHaveCount(BOOKINGS.length);
  });
});
