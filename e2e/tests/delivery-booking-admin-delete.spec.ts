/**
 * Admin "Delivery Slots" tab — per-booking delete button.
 *
 * Product gap: capacity per window is 4, and a junk/duplicate booking
 * permanently held a slot with no UI recourse (SQL was the only way to
 * free it). This adds a delete button per row in the "Who's booked" card,
 * backed by the `deleteDeliveryBooking(id: ID!): Boolean!` mutation added
 * in techaid-server PR #60.
 *
 * Not yet deployed to UAT, so this spec is fully mocked (@mocked) — no live
 * backend dependency, runs in the fast CI suite.
 */
import { test, expect, Page, Route } from '@playwright/test';

async function fulfillSimple(route: Route, data: any) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

const BOOKING_ALICE = {
  id: 'bk-1',
  date: '2026-07-20',
  dayLabel: 'Mon 20 Jul',
  window: { id: 'w-morning', name: 'Morning' },
  firstName: 'Alice',
  surname: 'Ainsley',
  email: 'alice@example.com',
  phone: '07700000001',
  address: '1 Test Street',
  accessNotes: '',
  ctaReference: 1001,
  createdAt: '2026-07-01T09:00:00Z',
  matchedRequestId: null,
  matchedRequestStatus: null,
  matchedRequestOpen: null,
};

const BOOKING_BOB = {
  ...BOOKING_ALICE,
  id: 'bk-2',
  firstName: 'Bob',
  surname: 'Bobson',
  email: 'bob@example.com',
  phone: '07700000002',
  ctaReference: 1002,
};

const BOOKING_CAROL = {
  id: 'bk-3',
  date: '2026-07-21',
  dayLabel: 'Tue 21 Jul',
  window: { id: 'w-afternoon', name: 'Afternoon' },
  firstName: 'Carol',
  surname: 'Carlson',
  email: 'carol@example.com',
  phone: '07700000003',
  address: '3 Test Street',
  accessNotes: 'Ring bell twice',
  ctaReference: 1003,
  createdAt: '2026-07-02T09:00:00Z',
  matchedRequestId: null,
  matchedRequestStatus: null,
  matchedRequestOpen: null,
};

async function installGraphqlMocks(
  page: Page,
  opts: { bookings?: any[]; captureDelete?: { body: any }[]; deleteResult?: boolean } = {},
) {
  const bookings = opts.bookings ?? [BOOKING_ALICE, BOOKING_BOB, BOOKING_CAROL];
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfillSimple(route, {
        buildInfo: { version: '1.0.0-test', commit: 'abc123', time: '2026-01-01T00:00:00Z' },
      });
    }
    if (body.includes('featureFlagsPublic')) {
      // production:false in the uat-local test config already makes the tab
      // visible regardless of this flag — included for completeness/realism.
      return fulfillSimple(route, { featureFlagsPublic: [{ key: 'delivery-booking', enabled: true }] });
    }
    if (body.includes('findAllDeviceRequests')) {
      return fulfillSimple(route, { deviceRequestConnection: { totalElements: 0, content: [] } });
    }
    if (body.includes('deliverySlotsAdmin')) {
      return fulfillSimple(route, {
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
        deliveryBookingsAdmin: bookings,
      });
    }
    if (body.includes('deleteDeliveryBooking')) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // ignore
      }
      if (parsed && opts.captureDelete) {
        opts.captureDelete.push({ body: parsed });
      }
      return fulfillSimple(route, { deleteDeliveryBooking: opts.deleteResult ?? true });
    }
    return fulfillSimple(route, {});
  });
}

async function openDeliverySlotsTab(page: Page) {
  await page.goto('/dashboard/distributions-and-deliveries');
  const tabLink = page.getByRole('link', { name: /Delivery Slots/ });
  await tabLink.waitFor({ state: 'visible', timeout: 15_000 });
  await tabLink.click();
  await page.getByText("Who's booked").waitFor({ state: 'visible', timeout: 15_000 });
}

function bookingCountBadge(page: Page) {
  return page.locator('.card', { hasText: "Who's booked" }).locator('.badge.badge-secondary');
}

function bookingRow(page: Page, name: string) {
  // Scope to rows that actually carry the new delete control, then filter by
  // rendered name — avoids collisions with the (hidden but still-in-DOM)
  // Device Requests tab table.
  return page
    .locator('tr', { has: page.getByTestId('delete-booking') })
    .filter({ hasText: name });
}

test.describe('Delivery slots admin — delete booking @mocked', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('confirming the dialog deletes the booking: mutation fires with the right id, row disappears, count decrements', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const captured: { body: any }[] = [];
    await installGraphqlMocks(page, { captureDelete: captured, deleteResult: true });

    let dialogMessage = '';
    page.on('dialog', dialog => {
      dialogMessage = dialog.message();
      dialog.accept().catch(() => {});
    });

    await openDeliverySlotsTab(page);
    await expect(bookingCountBadge(page)).toContainText('3 booking');

    const aliceRow = bookingRow(page, 'Alice Ainsley');
    await expect(aliceRow).toBeVisible();
    await aliceRow.getByTestId('delete-booking').click();

    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(captured[0].body?.variables?.id, 'deleteDeliveryBooking must be called with the booking id').toBe('bk-1');

    // The confirm() message should identify the booking being removed.
    expect(dialogMessage).toContain('Alice Ainsley');
    expect(dialogMessage).toContain('CTA-1001');
    expect(dialogMessage).toContain('Mon 20 Jul');

    await expect(aliceRow).toHaveCount(0);
    await expect(bookingRow(page, 'Bob Bobson'), 'other bookings in the group must remain').toBeVisible();
    await expect(bookingCountBadge(page)).toContainText('2 booking');
  });

  test('dismissing the confirm dialog leaves the booking untouched: no mutation fires', async ({ page }) => {
    test.setTimeout(60_000);
    const captured: { body: any }[] = [];
    await installGraphqlMocks(page, { captureDelete: captured });

    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    await openDeliverySlotsTab(page);
    await expect(bookingCountBadge(page)).toContainText('3 booking');

    const aliceRow = bookingRow(page, 'Alice Ainsley');
    await aliceRow.getByTestId('delete-booking').click();

    // Give a wrongly-fired mutation a chance to show up before asserting none did.
    await page.waitForTimeout(500);
    expect(captured.length, 'deleteDeliveryBooking must NOT fire when the confirm dialog is dismissed').toBe(0);

    await expect(aliceRow).toBeVisible();
    await expect(bookingCountBadge(page)).toContainText('3 booking');
  });

  test('deleting the last booking in a group removes the whole group', async ({ page }) => {
    test.setTimeout(60_000);
    const captured: { body: any }[] = [];
    await installGraphqlMocks(page, { bookings: [BOOKING_CAROL], captureDelete: captured, deleteResult: true });

    page.on('dialog', dialog => dialog.accept().catch(() => {}));

    await openDeliverySlotsTab(page);
    await expect(bookingCountBadge(page)).toContainText('1 booking');

    const carolRow = bookingRow(page, 'Carol Carlson');
    await carolRow.getByTestId('delete-booking').click();

    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThan(0);
    await expect(page.getByText('No bookings yet.')).toBeVisible();
    await expect(bookingCountBadge(page)).toContainText('0 booking');
  });
});
