/**
 * #281: the Delivery Slots CSV goes to the driver, so a booking deleted on the tab must not be
 * in it. The delete handler used to prune the on-screen groups but not the flat list the export
 * read, so the deleted booking stayed in the CSV for the rest of the page's life.
 *
 * @mocked — all GraphQL stubbed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginAsStaff } from '../helpers/auth0-cache';

const json = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const base = {
  date: '2026-08-03',
  dayLabel: 'Monday 3 August',
  window: { id: 'w1', name: 'Morning' },
  email: 'x@example.org',
  phone: '07700900100',
  address: '10 Example Street',
  accessNotes: '',
  createdAt: '2026-07-18T09:00:00Z',
  matchedRequestId: null,
  matchedRequestStatus: null,
  matchedRequestOpen: null,
};
const KEEP = { ...base, id: 'bk-keep', firstName: 'Kept', surname: 'Booking', ctaReference: 9201 };
const GONE = { ...base, id: 'bk-gone', firstName: 'Deleted', surname: 'Booking', ctaReference: 9202 };

async function install(page: Page, exportIds: { ids: unknown[] }[]) {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deleteDeliveryBooking')) return json(route, { deleteDeliveryBooking: true });
    if (body.includes('deliveryExportOrgs')) {
      exportIds.push({ ids: JSON.parse(body).variables.ids });
      return json(route, { deviceRequestConnection: { content: [] } });
    }
    if (body.includes('deliverySlotsAdmin')) {
      return json(route, { deliveryBookingsAdmin: [KEEP, GONE], deliveryWindowsAdmin: [] });
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

test.describe('delivery-slots export after delete (#281) @mocked', () => {
  test('a deleted booking is not in the exported CSV', async ({ page }) => {
    test.setTimeout(60_000);
    const exportCalls: { ids: unknown[] }[] = [];
    await install(page, exportCalls);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await loginAsStaff(page);

    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
    const goneRow = page.locator('tr', { has: page.getByTestId('delete-booking') }).filter({ hasText: 'Deleted Booking' });
    await expect(goneRow).toBeVisible({ timeout: 15_000 });
    await goneRow.getByTestId('delete-booking').click();
    await expect(goneRow).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-bookings-csv').click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    const csv = Buffer.concat(chunks).toString('utf-8');

    expect(csv).toContain('Kept Booking');
    expect(csv, 'deleted booking must not reach the driver').not.toContain('Deleted Booking');
    expect(csv).not.toContain('9202');
    expect(exportCalls[0].ids, 'org lookup must not ask for the deleted booking').toEqual([9201]);
  });

  test('deleting every booking disables Export CSV', async ({ page }) => {
    test.setTimeout(60_000);
    await install(page, []);
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await loginAsStaff(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
    const rows = page.getByTestId('delete-booking');
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await rows.first().click();
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('export-bookings-csv')).toBeDisabled();
  });
});
