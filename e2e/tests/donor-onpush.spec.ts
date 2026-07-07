/**
 * Hygiene 6.5 — OnPush pilot regression cover for donor-index.
 *
 * DonorIndexComponent is the ChangeDetectionStrategy.OnPush pilot. Its two
 * template-bound state mutations happen OUTSIDE the host template's event
 * tree, so each must call cdr.markForCheck() explicitly:
 *
 *   1. the DataTables ajax callback resolving the GraphQL promise and setting
 *      `entities` (renders the table body), and
 *   2. `applyFilter()` invoked from the filter modal's footer — the modal's
 *      embedded view lives in NgbModal's window component, not the host — and
 *      setting `filterCount` (renders the badge on the Filter button).
 *
 * If either markForCheck() is dropped, the corresponding assertion here goes
 * red: rows never paint / the badge never appears. @mocked so it runs in the
 * CI gate on every PR.
 */
import { test, expect } from '@playwright/test';

async function fulfillSimple(route: import('@playwright/test').Route, data: any) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

const donorRow = (id: number, name: string) => ({
  id,
  name,
  postCode: 'SW9 0AA',
  phoneNumber: '07700900000',
  email: `${name.toLowerCase()}@example.org`,
  kitCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archived: false,
  isLeadContact: false,
  donorParent: null,
});

test.describe('donor-index OnPush pilot @mocked', () => {
  test('table rows and filter badge repaint under OnPush', async ({ page }) => {
    test.setTimeout(60_000);

    const donorQueries: string[] = [];
    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) {
        return fulfillSimple(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      if (body.includes('findAllDonors')) {
        donorQueries.push(body);
        return fulfillSimple(route, {
          donorsConnection: {
            totalElements: 2,
            content: [donorRow(1, 'ONPUSH-ALPHA'), donorRow(2, 'ONPUSH-BETA')],
          },
        });
      }
      return fulfillSimple(route, {});
    });

    // ── 1. ajax-callback path: rows must render from `entities` ────────────
    await page.goto('/dashboard/donors');
    await expect(page.locator('#donor-index tbody tr', { hasText: 'ONPUSH-ALPHA' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#donor-index tbody tr', { hasText: 'ONPUSH-BETA' })).toBeVisible();

    // No filter applied yet — the Filter button carries no count badge.
    // (Substring name match: the icon span puts leading whitespace in the
    // accessible name, so an anchored regex never matches.)
    const filterButton = page.getByRole('link', { name: 'Filter' });
    await expect(filterButton.locator('.badge')).toHaveCount(0);

    // ── 2. filter-modal path: the badge must repaint after applyFilter ─────
    await filterButton.click();
    await page.getByRole('checkbox', { name: 'Active Donors' }).check();
    const filteredQuery = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllDonors'),
      { timeout: 15_000 },
    );
    await page.locator('.modal-footer').getByRole('button', { name: 'Filter' }).click();
    await filteredQuery;

    // The badge is host-template state set from the modal's view — the OnPush
    // markForCheck in applyFilter() is what makes this appear.
    await expect(filterButton.locator('.badge')).toHaveText('1', { timeout: 10_000 });
    // And the reload actually carried the archived filter to the backend.
    expect(donorQueries.some(q => q.includes('archived'))).toBe(true);

    // ── 3. clearing the filter removes the badge again ──────────────────────
    await filterButton.click();
    await page.getByRole('checkbox', { name: 'Active Donors' }).uncheck();
    await page.locator('.modal-footer').getByRole('button', { name: 'Filter' }).click();
    await expect(filterButton.locator('.badge')).toHaveCount(0, { timeout: 10_000 });

    // Rows are still painted after the reload round-trips.
    await expect(page.locator('#donor-index tbody tr', { hasText: 'ONPUSH-ALPHA' })).toBeVisible();
  });
});
