/**
 * #283: the Delivery Slots tab
 *  - loads its bookings only when the tab is first opened (the host keeps it mounted but hidden),
 *  - has a Refresh button that re-queries so new bookings appear without a page reload,
 *  - and no longer talks about "delivery slot settings" (those moved to the Admin Panel).
 *
 * @mocked — all GraphQL stubbed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginAsStaff } from '../helpers/auth0-cache';

const json = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const booking = (id: string, first: string, ref: number) => ({
  id,
  date: '2026-08-03',
  dayLabel: 'Monday 3 August',
  window: { id: 'w1', name: 'Morning' },
  firstName: first,
  surname: 'Booker',
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

async function install(page: Page, state: { loads: number; bookings: unknown[]; delayMs?: number }) {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliverySlotsAdmin')) {
      state.loads++;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      return json(route, { deliveryBookingsAdmin: state.bookings, deliveryWindowsAdmin: [] });
    }
    if (body.includes('featureFlagsPublic')) return json(route, { featureFlagsPublic: [] });
    if (body.includes('findAllDeviceRequests')) {
      return json(route, { deviceRequestConnection: { totalElements: 0, content: [] } });
    }
    if (body.includes('buildInfo')) {
      return json(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    return json(route, {});
  });
}

test.describe('delivery-slots lazy load, refresh and wording (#283) @mocked', () => {
  test('bookings are not fetched until the tab is opened, then fetched once', async ({ page }) => {
    test.setTimeout(60_000);
    const state = { loads: 0, bookings: [booking('b1', 'Alma', 9301)] };
    await install(page, state);
    await loginAsStaff(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    const tab = page.getByRole('link', { name: 'Delivery Slots' });
    await expect(tab).toBeVisible({ timeout: 15_000 });
    // Let the Device Requests tab finish its own load, then confirm the slots query stayed quiet.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(state.loads, 'bookings must not load while the tab is hidden').toBe(0);

    await tab.click();
    await expect(page.locator('tr', { hasText: 'Alma Booker' })).toBeVisible({ timeout: 15_000 });
    expect(state.loads).toBe(1);

    // Switching away and back must not re-fetch; Refresh is the explicit way.
    await page.getByRole('link', { name: 'Device Requests' }).click();
    await tab.click();
    await page.waitForTimeout(500);
    expect(state.loads).toBe(1);
  });

  test('Refresh re-queries and shows a booking made since the tab loaded', async ({ page }) => {
    test.setTimeout(60_000);
    const state = { loads: 0, bookings: [booking('b1', 'Alma', 9301)] };
    await install(page, state);
    await loginAsStaff(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
    await expect(page.locator('tr', { hasText: 'Alma Booker' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tr', { hasText: 'Bea Booker' })).toHaveCount(0);

    state.bookings = [booking('b1', 'Alma', 9301), booking('b2', 'Bea', 9302)];
    await page.getByTestId('refresh-bookings').click();
    await expect(page.locator('tr', { hasText: 'Bea Booker' })).toBeVisible({ timeout: 15_000 });
    expect(state.loads).toBe(2);
  });

  test('loading text no longer mentions delivery slot settings', async ({ page }) => {
    test.setTimeout(60_000);
    const state = { loads: 0, bookings: [booking('b1', 'Alma', 9301)], delayMs: 3000 };
    await install(page, state);
    await loginAsStaff(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
    await expect(page.getByText('Loading delivery bookings…')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('delivery slot settings')).toHaveCount(0);
  });
});
