/**
 * Regression: kit-info "locked status" behaviour.
 *
 * Three things must hold together when ANY of the five `subStatus.*` "lock" flags
 * (needsFurtherInvestigation, needsSparePart, installationOfOSFailed, wipeFailed,
 * lockedToUser) is true on a kit:
 *   1. The flag's checkbox renders as `checked` on initial page load.
 *   2. The "Status of the device" radio group is fully disabled.
 *   3. The yellow "Status locked: …" banner is visible.
 *
 * Earlier breakage history:
 *   - Apollo v4 froze the nested subStatus object → flag dropped (fixed in 0e7f35b)
 *   - Formly's resetFieldOnHide scrubbed flags on first build (fixed in 5874369
 *     via `resetOnHide: false` on each subStatus.* checkbox)
 *   - `@if (model?.id)` wrapper around <formly-form> introduced a race where
 *     the imperative `form.get('status').disable()` ran before the form was
 *     built; banner appeared but radios stayed enabled (this regression test)
 *   - `custom-kit-checkbox.ts` had a dual `[formControl]` + `[(ngModel)]="value"`
 *     binding where `value` was uninitialised; NgModel could write undefined
 *     into the FormControl, leaving the box unchecked even when the model held
 *     true (also covered by this test)
 *
 * The mock kit below stands in for the real UAT device 2129 the original bug
 * was filed against — same shape, same lock flag, no live API dependency.
 */
import { test, expect } from '@playwright/test';

const KIT_BASE = {
  id: 2129,
  type: 'LAPTOP',
  status: 'PROCESSING_OS_INSTALLED',
  model: 'ThinkPad T480',
  location: 'BANK',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  age: 5,
  archived: false,
  make: 'Lenovo',
  deviceVersion: null,
  serialNo: 'SN-2129',
  storageCapacity: 256,
  typeOfStorage: 'SSD',
  ramCapacity: 16,
  cpuType: 'i7',
  cpuCores: 4,
  tpmVersion: 2,
  batteryHealth: 85,
  lotId: null,
  locationCode: 'A1',
  donor: null,
  deviceRequest: null,
  attributes: { credentials: '', status: '', notes: '', network: '', state: '', otherType: '' },
  notes: [],
};

const SUBSTATUS_UNFLAGGED = {
  installationOfOSFailed: false,
  wipeFailed: false,
  needsSparePart: false,
  needsFurtherInvestigation: false,
  network: null,
  installedOSName: ['WINDOWS_11'],
  lockedToUser: false,
};

async function installGraphqlMocks(page: import('@playwright/test').Page, subStatus: any) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { buildInfo: { version: '1.0.0-test', commit: 'abc123', time: '2026-01-01T00:00:00Z' } } }),
      });
      return;
    }
    if (body.includes('findKit')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { kit: { ...KIT_BASE, subStatus } } }),
      });
      return;
    }
    if (body.includes('autoCompleteDonors') || body.includes('autoCompleteDeviceRequests')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
  });
}

function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const labelText = (el: Element) => (el.textContent || '').trim();
    const allLabels = Array.from(document.querySelectorAll('label'));

    const nfiLabel = allLabels.find(l => labelText(l).includes('Needs further investigation'));
    const nfiCheckbox = (nfiLabel?.parentElement?.querySelector('input[type="checkbox"]') ?? null) as HTMLInputElement | null;

    const statusLabel = allLabels.find(l => labelText(l).includes('Status of the device'));
    const statusFf = statusLabel?.closest('formly-field');
    const statusRadios = statusFf ? Array.from(statusFf.querySelectorAll<HTMLInputElement>('input[type="radio"]')) : [];

    const banner = Array.from(document.querySelectorAll('.alert.alert-warning')).find(a => (a.textContent || '').includes('Status locked'));

    return {
      nfiChecked: nfiCheckbox?.checked,
      allStatusDisabled: statusRadios.length > 0 && statusRadios.every(r => r.disabled),
      anyStatusDisabled: statusRadios.some(r => r.disabled),
      bannerVisible: !!banner && (banner as HTMLElement).offsetParent !== null,
    };
  });
}

test('locked kit: NFI checkbox checked, status radios disabled, banner shown', async ({ page }) => {
  test.setTimeout(60_000);
  await installGraphqlMocks(page, { ...SUBSTATUS_UNFLAGGED, needsFurtherInvestigation: true });

  await page.goto('/dashboard/devices/2129');
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2000);

  const r = await probe(page);
  expect(r.nfiChecked, 'needsFurtherInvestigation checkbox should render checked').toBe(true);
  expect(r.allStatusDisabled, 'all status radios should be disabled').toBe(true);
  expect(r.bannerVisible, '"Status locked" banner should be visible').toBe(true);
});

test('unlocked kit: status radios enabled and banner hidden', async ({ page }) => {
  test.setTimeout(60_000);
  await installGraphqlMocks(page, SUBSTATUS_UNFLAGGED);

  await page.goto('/dashboard/devices/2129');
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2000);

  const r = await probe(page);
  expect(r.nfiChecked, 'needsFurtherInvestigation checkbox should be unchecked').toBe(false);
  expect(r.anyStatusDisabled, 'no status radio should be disabled when nothing is locked').toBe(false);
  expect(r.bannerVisible, '"Status locked" banner should be hidden').toBe(false);
});
