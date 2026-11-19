/**
 * Issue #232, part 3: when the server's battery-health guard rejects a save, staff read the
 * server's own message, not "Something went wrong.", on the device form and in bulk edit.
 *
 * This is a pin, not a fix: both saves already go through the shared `toastError`
 * (src/app/shared/utils/error-toast.ts), which shows BAD_REQUEST messages and short human
 * sentences as written. So there is no red step; the spec keeps it that way.
 *
 * Two server responses are mocked, because the server sends one today and should send the
 * other later:
 *   - today: `BatteryHealthTooLowException` has no `@GraphQlExceptionHandler` (unlike the
 *     wipe-cert and blocking-flag guards), so `CustomErrorHandlerConfig` passes the raw message
 *     to signed-in staff with classification DataFetchingException. It shows only because it
 *     is a short sentence that doesn't look technical.
 *   - after the server fix (a dedicated handler, like the other two guards): BAD_REQUEST, which
 *     the dashboard always shows as written.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; the Auth0 cache is written directly.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';
import { UNEXPECTED_TEXT } from '../../src/app/shared/utils/error-toast';

const KIT_ID = 2132;
// The text BatteryHealthGuardService writes (techaid-server#264).
const MESSAGE =
  `Kit ${KIT_ID} cannot progress to ALLOCATION_READY: Battery health too low (40%), please see guide for next steps`;

const RESPONSES: [string, string][] = [
  ['today (no dedicated handler)', 'DataFetchingException'],
  ['after the server fix', 'BAD_REQUEST'],
];

const rejection = (classification: string) =>
  ({ data: null, errors: [{ message: MESSAGE, extensions: { classification } }] });

// Battery at 60 so the form's own low-battery lock stays out of the way: this spec is about
// the server's message, not the form lock (kit-battery-status-lock.spec.ts).
const KIT = {
  id: KIT_ID, type: 'LAPTOP', status: 'PROCESSING_OS_INSTALLED', model: 'ThinkPad T480', location: 'BANK',
  createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', age: 5, archived: false, make: 'Lenovo',
  deviceVersion: null, serialNo: `SN-${KIT_ID}`, storageCapacity: 256, typeOfStorage: 'SSD', ramCapacity: 16,
  cpuType: 'i7', cpuCores: 4, tpmVersion: '2.0', batteryHealth: 60, lotId: null, locationCode: 'A1',
  donor: null, deviceRequest: null, notes: [],
  subStatus: {
    installationOfOSFailed: false, wipeFailed: false, needsSparePart: false,
    needsFurtherInvestigation: false, network: null, installedOSName: ['WINDOWS_11'], lockedToUser: false,
  },
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** Mocks the API: `mutation` is the save that gets rejected, everything else answers empty. */
async function mockApi(page: Page, mutation: 'updateKit' | 'updateKits', classification: string) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return json(route, { data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
    // `updateKits(` before `updateKit(`: the bulk mutation's name contains the single one's.
    if (mutation === 'updateKits' && body.includes('updateKits(')) return json(route, rejection(classification));
    if (mutation === 'updateKit' && body.includes('updateKit(')) return json(route, rejection(classification));
    if (body.includes('findKit(')) return json(route, { data: { kit: KIT } });
    if (body.includes('findAllKits')) {
      return json(route, { data: { kitsConnection: { totalElements: 1, number: 0, content: [{
        id: KIT_ID, make: 'Lenovo', model: 'ThinkPad T480', age: 5, type: 'LAPTOP', status: 'PROCESSING_OS_INSTALLED',
        location: 'BANK', updatedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
        lotId: null, donor: null, deviceRequest: null,
      }] } } });
    }
    return json(route, { data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
  });
}

async function expectServerMessage(page: Page) {
  const toast = page.locator('.toast-error .toast-message').first();
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(MESSAGE);
  await expect(toast).not.toContainText(UNEXPECTED_TEXT);
}

test.describe('kit battery guard: the server message reaches staff (#232) @mocked', () => {
  for (const [when, classification] of RESPONSES) {
    test(`device form save shows the server message, ${when}`, async ({ page }) => {
      test.setTimeout(60_000);
      await loginWith(page, ['read:kits', 'write:kits']);
      await mockApi(page, 'updateKit', classification);
      await page.goto(`/dashboard/devices/${KIT_ID}`);
      await page.locator('label:has-text("Status of the device")').waitFor({ state: 'visible', timeout: 30_000 });

      await page.locator('button:has-text("Save")').first().click();
      await expectServerMessage(page);
    });

    test(`bulk update shows the server message, ${when}`, async ({ page }) => {
      test.setTimeout(60_000);
      await loginWith(page, ['app:bulkedit', 'read:kits', 'write:kits']);
      await mockApi(page, 'updateKits', classification);
      await page.goto('/dashboard/devices');
      await expect(page.locator('#kit-index tbody tr').first()).toBeVisible({ timeout: 30_000 });

      // The switch's own <input> sits under its label — click the label, as a user would.
      await page.locator('label[for="bulkToggle"]').click();
      await page.locator('#kit-index tbody tr').first().locator('input[type="checkbox"]').click();
      const bulkButton = page.locator('label .btn-warning', { hasText: 'Bulk Update' });
      await expect(bulkButton.locator('.badge')).toHaveText('1', { timeout: 10_000 });
      // Toastr sits top-right over the card header; clear it before clicking through.
      await page.evaluate(() => document.querySelector('#toast-container')?.remove());
      await bulkButton.click();

      const modal = page.locator('.modal-dialog');
      await modal.locator('.modal-body ng-select').first().click();
      await page.locator('.ng-dropdown-panel .ng-option', { hasText: 'Assessment check completed' }).click();
      // Escape only while the panel is open: on a closed ng-select it dismisses the whole modal.
      const panel = page.locator('.ng-dropdown-panel');
      if (await panel.isVisible()) await page.keyboard.press('Escape');
      await modal.locator('.modal-footer .btn-warning', { hasText: 'UPDATE' }).click();

      await expectServerMessage(page);
    });
  }
});
