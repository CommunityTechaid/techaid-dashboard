/**
 * Mocked coverage for the "Export CSV" button on the admin "Delivery Slots" tab
 * (delivery-slots.component.html / .ts). The button sits in the same flex row as the
 * "have moved to Admin Panel" message, and on click resolves each booking's org via a
 * second GraphQL query (deliveryExportOrgs) before downloading a CSV shaped to match
 * the "TaDa Import" tab of the driver's Delivery Schedule spreadsheet.
 *
 * The tab lives on the Distributions & Deliveries page and loads via Apollo
 * (deliverySlotsAdmin, whose deliveryBookingsAdmin field carries the rows). Apollo
 * POSTs to /graphql so page.route catches it.
 *
 * acceptDownloads defaults to true on BrowserContextOptions (see
 * node_modules/playwright-core/types/types.d.ts), and playwright.config.ts doesn't
 * override it, so page.waitForEvent('download') works without extra context options.
 *
 * @mocked — no token (fake JWT satisfies AuthGuard), all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Minimal CSV field splitter: respects double-quoted fields (which may themselves contain
 *  commas, e.g. the Address field), so field counts can be asserted without a naive
 *  split(',') being fooled by commas inside quotes. */
function splitCsvFields(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

const WINDOW = { id: 'win-1', name: 'Morning window' };

/** Two bookings: one org-matched with access notes, one unmatched without — different dates
 *  (deliberately out of ascending order here) so the CSV's own sort is exercised. */
const BOOKINGS = [
  {
    id: 'bk-later',
    date: '2026-08-05',
    dayLabel: 'Wednesday 5 August',
    window: WINDOW,
    firstName: 'Fiona',
    surname: 'Unmatched',
    email: 'fiona@example.org',
    phone: '07700900102',
    address: '12 Example Road',
    accessNotes: '',
    ctaReference: 9102,
    createdAt: '2026-07-18T09:05:00Z',
    matchedRequestId: '5552',
    matchedRequestStatus: 'REQUEST_COMPLETED',
    matchedRequestOpen: false,
  },
  {
    id: 'bk-earlier',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: WINDOW,
    firstName: 'Erin',
    surname: 'Matched',
    email: 'erin@example.org',
    phone: '07700900101',
    address: '10 Example Street',
    accessNotes: 'Ring bell twice',
    ctaReference: 9101,
    createdAt: '2026-07-18T09:00:00Z',
    matchedRequestId: '5551',
    matchedRequestStatus: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
    matchedRequestOpen: true,
  },
];

/** Only the earlier booking's ctaReference (9101) resolves to a device request/org. */
const EXPORT_ORGS_DATA = {
  deviceRequestConnection: {
    content: [
      {
        id: '9101',
        referringOrganisationContact: { referringOrganisation: { name: 'Org A' } },
      },
    ],
  },
};

async function installExportMocks(page: Page, bookings: unknown[]): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliveryExportOrgs')) {
      return fulfillJson(route, { data: EXPORT_ORGS_DATA });
    }
    if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
      return fulfillJson(route, { data: { deliveryBookingsAdmin: bookings } });
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

async function openDeliverySlots(page: Page, bookings: unknown[]): Promise<void> {
  await installExportMocks(page, bookings);
  await page.goto('/dashboard/distributions-and-deliveries');
  await page.getByRole('link', { name: 'Delivery Slots' }).click();
}

test.describe('delivery-slots export CSV @mocked', () => {
  test('the button sits in the same flex row as the "have moved to" message', async ({ page }) => {
    test.setTimeout(60_000);
    await openDeliverySlots(page, BOOKINGS);

    const button = page.getByTestId('export-bookings-csv');
    await expect(button).toBeVisible({ timeout: 15_000 });

    const sameRow = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="export-bookings-csv"]');
      const msg = Array.from(document.querySelectorAll('div.text-muted.small')).find((el) =>
        el.textContent?.includes('have moved to'),
      );
      if (!btn || !msg || btn.parentElement !== msg.parentElement) {
        return false;
      }
      return btn.parentElement!.classList.contains('justify-content-between');
    });
    expect(sameRow).toBe(true);
  });

  test('downloads a CSV with UK dates, resolved org names, access notes and ascending date order', async ({ page }) => {
    test.setTimeout(60_000);
    await openDeliverySlots(page, BOOKINGS);
    await expect(page.locator('tr', { hasText: 'Erin Matched' })).toBeVisible({ timeout: 15_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-bookings-csv').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^delivery-schedule-\d{4}-\d{2}-\d{2}\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    // The download opens with a UTF-8 BOM so Excel doesn't misread it — strip before comparing.
    const csv = Buffer.concat(chunks).toString('utf-8').replace(/^\ufeff/, '');
    const lines = csv.trim().split('\r\n');

    // Fields 8 and 9 are deliberately blank (not just "no Access Notes column"): a block of
    // rows pastes straight into a weekly driver tab where H is "Delivered (Y or N)", I is the
    // follow-up call permission, and J is "Notes" — so Access Notes has to land in the 10th
    // field, with H/I left for the driver to fill in by hand.
    expect(lines[0]).toBe('Date,Req No.,Distributions Only,Name,Org,Address,Telephone no.,,,Access Notes');

    // Ascending date order: the 3 August booking (mocked second) must sort ahead of the
    // 5 August booking (mocked first).
    const expectedMatchedLine =
      '03/08/2026,9101,Distribution,Erin Matched,Org A,10 Example Street,07700900101,,,Ring bell twice';
    const expectedUnmatchedLine =
      '05/08/2026,9102,Distribution,Fiona Unmatched,,12 Example Road,07700900102,,,';
    expect(lines[1]).toBe(expectedMatchedLine);
    expect(lines[2]).toBe(expectedUnmatchedLine);

    // Every emitted line has exactly 10 comma-separated fields, fields 8 and 9 empty.
    for (const line of lines) {
      const fields = splitCsvFields(line);
      expect(fields).toHaveLength(10);
      expect(fields[7]).toBe('');
      expect(fields[8]).toBe('');
    }
  });

  test('is disabled when there are no bookings to export', async ({ page }) => {
    test.setTimeout(60_000);
    await openDeliverySlots(page, []);

    const button = page.getByTestId('export-bookings-csv');
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expect(button).toBeDisabled();
  });
});
