/**
 * Regression cover for the second round of UAT feedback on the delivery booking admin:
 *
 *  1. "Dates on delivery slots page / who's booked seem to be US format" - Angular's default
 *     LOCALE_ID is en-US, so `| date:'short'` rendered 7/18/26, 9:00 AM. main.ts now registers
 *     en-GB and provides it as LOCALE_ID, so the Booked column reads 18/07/2026, 10:00.
 *  2. Feedback #13 - the "Allow another booking" button was clipped on the right edge. The
 *     action column was 4% of a table-layout:fixed table and the <td> itself was display:flex,
 *     so the buttons sized themselves and spilled past the last column.
 *  3. Feedback #11 - the booking-settings switch sat ~20px outside the card body, on the card
 *     border next to the sidebar. src/sb-admin.css (Bootstrap 4 era, loaded after Bootstrap 5)
 *     shrinks .form-check's padding while Bootstrap's more specific .form-switch rule keeps the
 *     -2.5em input margin. styles.css now re-asserts the Bootstrap 5 geometry.
 *
 * @mocked - no token, all GraphQL stubbed, fake JWT from CI/save-token.mjs satisfies AuthGuard.
 */
import { test, expect, Page, Route } from '@playwright/test';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';
const DISTRIBUTIONS_PATH = '/dashboard/distributions-and-deliveries';

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const WINDOW = { id: 'win-1', name: 'Morning window' };

const BOOKINGS = [
  {
    id: 'bk-1',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Dana',
    surname: 'Datestamp',
    email: 'dana@example.org',
    phone: '07700900010',
    address: '10 Long Street Name That Wraps, London',
    accessNotes: 'Buzz flat 4',
    ctaReference: 9101,
    createdAt: '2026-07-18T09:00:00Z',
    matchedRequestId: '5551',
    matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
    matchedRequestOpen: true,
    additionalBookingAllowed: false,
  },
];

const CONFIG_DATA = {
  deliveryConfig: {
    id: 'cfg-1',
    enabled: true,
    daysOfWeek: '3,4',
    leadTimeDays: 7,
    advanceDays: 21,
    updatedAt: '2026-07-18T00:00:00Z',
  },
  deliveryWindowsAdmin: [
    {
      id: 'win-1',
      name: 'Morning window',
      startTime: '10:00am',
      endTime: '1:00pm',
      icon: '☀️',
      capacity: 5,
      sortOrder: 1,
      active: true,
    },
  ],
  deliveryBlockedDates: [],
};

async function installMocks(page: Page): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliveryConfigAdmin')) {
      return fulfillJson(route, { data: CONFIG_DATA });
    }
    if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
      return fulfillJson(route, { data: { deliveryBookingsAdmin: BOOKINGS } });
    }
    if (body.includes('BoroughAvailabilityAdmin')) {
      return fulfillJson(route, {
        data: { boroughGroups: [], referrerLimitExceptions: [], adminConfig: null },
      });
    }
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    }
    if (body.includes('findAllDeviceRequests')) {
      return fulfillJson(route, {
        data: { deviceRequestConnection: { totalElements: 0, content: [] } },
      });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, {
        data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } },
      });
    }
    return fulfillJson(route, { data: {} });
  });
}

async function openWhosBooked(page: Page): Promise<void> {
  await installMocks(page);
  await page.goto(DISTRIBUTIONS_PATH);
  await page.getByRole('link', { name: 'Delivery Slots' }).click();
  await expect(page.locator('tr', { hasText: 'Dana Datestamp' })).toBeVisible({ timeout: 15_000 });
}

test.describe('delivery slots - booked list layout and dates @mocked', () => {
  test('the Booked column renders a UK date, not a US one', async ({ page }) => {
    test.setTimeout(60_000);
    await openWhosBooked(page);

    // 7th column = "Booked". Asserted as a shape rather than an exact instant so the spec is
    // timezone-agnostic: dd/mm/yyyy, HH:mm is en-GB; en-US would be "7/18/26, 9:00 AM".
    const bookedCell = page.locator('tr', { hasText: 'Dana Datestamp' }).locator('td').nth(6);
    await expect(bookedCell).toHaveText(/^\s*\d{2}\/\d{2}\/\d{4},\s\d{2}:\d{2}\s*$/);
  });

  test('the row action buttons stay inside the table instead of spilling off its right edge', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openWhosBooked(page);

    const tableBox = await page.locator('table.bookings-table').boundingBox();
    const allowBox = await page.getByTestId('allow-additional-booking').boundingBox();
    const deleteBox = await page.getByTestId('delete-booking').boundingBox();
    expect(tableBox).not.toBeNull();
    expect(allowBox).not.toBeNull();
    expect(deleteBox).not.toBeNull();

    // +1 for sub-pixel rounding on the last column's border.
    const tableRight = tableBox!.x + tableBox!.width + 1;
    expect(allowBox!.x + allowBox!.width).toBeLessThanOrEqual(tableRight);
    expect(deleteBox!.x + deleteBox!.width).toBeLessThanOrEqual(tableRight);
  });

  test('a narrow window scrolls the table rather than clipping the action buttons', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 900, height: 800 });
    await openWhosBooked(page);

    // Scope to the bookings table's own scroller: the Distributions & Deliveries page carries
    // other (hidden, zero-width) .table-responsive wrappers on its sibling tabs.
    const scroller = page.locator('.table-responsive:has(table.bookings-table)').first();
    const metrics = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    // Reachable by scrolling the container is the difference between "off to the right" and
    // "cut off": the button must still sit inside the table's own box.
    const tableBox = await page.locator('table.bookings-table').boundingBox();
    const allowBox = await page.getByTestId('allow-additional-booking').boundingBox();
    expect(allowBox!.x + allowBox!.width).toBeLessThanOrEqual(tableBox!.x + tableBox!.width + 1);
  });
});

test.describe('Admin Panel - booking settings switch alignment @mocked', () => {
  test('the delivery-bookings switch lines up with the panel content, not the card edge', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Delivery Configuration' }).click();

    const toggle = page.locator('#dsEnabled');
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // "Delivery days" sits at the card body's content edge - the switch must start there too.
    const anchor = page.locator('label', { hasText: 'Delivery days' }).first();
    const toggleBox = await toggle.boundingBox();
    const anchorBox = await anchor.boundingBox();
    const cardBox = await page
      .locator('.card', { hasText: 'Booking settings' })
      .first()
      .boundingBox();

    expect(toggleBox!.x).toBeGreaterThanOrEqual(anchorBox!.x - 1);
    // And it must be comfortably inside the card, not sitting on its border.
    expect(toggleBox!.x - cardBox!.x).toBeGreaterThanOrEqual(8);
  });
});
