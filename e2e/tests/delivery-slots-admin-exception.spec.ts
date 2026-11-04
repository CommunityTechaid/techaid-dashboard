/**
 * Admin exception bookings on the Delivery Slots tab (techaid-server#73).
 *
 * Policy (2026-11-04): admins only; the booking doesn't take a slot; any day; the normal
 * confirmation email; recorded as an exception. The server enforces all of it. This spec pins
 * the dashboard side:
 *   - only an `app:admin` user sees "Add exception booking";
 *   - the form sends submitDeliveryBookingAdmin with the fields typed, the CTA reference as a
 *     number and the window chosen, then reloads the list;
 *   - an exception booking in the list carries an "admin exception" badge naming who made it
 *     and why.
 *
 * @mocked: synthetic Auth0 session with explicit permissions, all GraphQL stubbed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const WINDOW = { id: '1', name: 'Morning window' };

const PUBLIC_BOOKING = {
  id: 'bk-public',
  date: '2026-12-01',
  dayLabel: 'Tuesday 1 December',
  window: WINDOW,
  firstName: 'Pat',
  surname: 'Public',
  email: 'pat@example.org',
  phone: '07700900001',
  address: '1 A Street',
  accessNotes: '',
  ctaReference: 9101,
  createdAt: '2026-11-04T09:00:00Z',
  matchedRequestId: '9101',
  matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
  matchedRequestOpen: true,
  adminException: false,
  bookedBy: null,
  exceptionReason: null,
};

const EXCEPTION_BOOKING = {
  ...PUBLIC_BOOKING,
  id: 'bk-exception',
  firstName: 'Eve',
  surname: 'Exception',
  ctaReference: 9102,
  matchedRequestId: '9102',
  adminException: true,
  bookedBy: 'admin@example.org',
  exceptionReason: 'Missed delivery, referee called',
};

async function installMocks(page: Page, sent: any[]): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('submitDeliveryBookingAdmin')) {
      sent.push(JSON.parse(body).variables);
      return fulfillJson(route, { data: { submitDeliveryBookingAdmin: { id: 'bk-new' } } });
    }
    if (body.includes('deliverySlotsAdmin')) {
      return fulfillJson(route, {
        data: {
          deliveryBookingsAdmin: [PUBLIC_BOOKING, EXCEPTION_BOOKING],
          deliveryWindowsAdmin: [
            { id: '1', name: 'Morning window', active: true },
            { id: '2', name: 'Afternoon window', active: true },
          ],
        },
      });
    }
    if (body.includes('featureFlagsPublic')) return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    if (body.includes('findAllDeviceRequests')) {
      return fulfillJson(route, { data: { deviceRequestConnection: { totalElements: 0, content: [] } } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

async function openSlotsTab(page: Page): Promise<void> {
  await page.goto('/dashboard/distributions-and-deliveries');
  await page.getByRole('link', { name: 'Delivery Slots' }).click();
  await expect(page.locator('tr', { hasText: 'Pat Public' })).toBeVisible({ timeout: 15_000 });
}

test.describe('delivery-slots admin exception bookings @mocked', () => {
  test('badges an exception booking with who made it and why, and leaves public bookings alone', async ({ page }) => {
    test.setTimeout(60_000);
    await authenticateWithPermissions(page, ['read:organisations']);
    await installMocks(page, []);
    await openSlotsTab(page);

    const badge = page.locator('tr', { hasText: 'Eve Exception' }).locator('[data-testid="admin-exception-badge"]');
    await expect(badge).toHaveText('admin exception');
    await expect(badge).toHaveAttribute('title', 'Booked by admin@example.org: Missed delivery, referee called');
    await expect(page.locator('tr', { hasText: 'Pat Public' }).locator('[data-testid="admin-exception-badge"]')).toHaveCount(0);
  });

  test('a non-admin does not get the exception booking form', async ({ page }) => {
    test.setTimeout(60_000);
    await authenticateWithPermissions(page, ['read:organisations', 'write:organisations']);
    await installMocks(page, []);
    await openSlotsTab(page);

    await expect(page.locator('[data-testid="add-exception-booking"]')).toHaveCount(0);
  });

  test('an admin books an exception and the list reloads', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await authenticateWithPermissions(page, ['app:admin', 'read:organisations', 'write:organisations']);
    await installMocks(page, sent);
    await openSlotsTab(page);

    await page.locator('[data-testid="add-exception-booking"]').click();
    const form = page.locator('[data-testid="exception-booking-form"]');
    await form.locator('[name="date"]').fill('2026-12-07');
    await form.locator('[name="windowId"]').selectOption('2');
    await form.locator('[name="ctaReference"]').fill('9103');
    await form.locator('[name="firstName"]').fill('Ann');
    await form.locator('[name="surname"]').fill('Other');
    await form.locator('[name="email"]').fill('ann@example.org');
    await form.locator('[name="phone"]').fill('07700900003');
    await form.locator('[name="address"]').fill('3 C Street');
    await form.locator('[name="exceptionReason"]').fill('Rebook after failed delivery');

    const reloads = page.waitForRequest((r) => (r.postData() ?? '').includes('deliverySlotsAdmin'));
    await form.getByRole('button', { name: 'Book exception' }).click();
    await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(1);
    await reloads;

    expect(sent[0].input).toEqual({
      date: '2026-12-07',
      windowId: '2',
      ctaReference: 9103,
      firstName: 'Ann',
      surname: 'Other',
      email: 'ann@example.org',
      phone: '07700900003',
      address: '3 C Street',
      accessNotes: null,
      exceptionReason: 'Rebook after failed delivery',
    });
    await expect(page.getByText('Exception booking added')).toBeVisible({ timeout: 5_000 });
  });
});
