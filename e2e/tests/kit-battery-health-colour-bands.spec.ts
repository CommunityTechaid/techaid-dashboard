/**
 * Issue #231: Battery Health colour coding has two bands.
 *   > 50                 → green
 *   <= 50, 0 or empty    → red   (exactly 50 is red, decided 2026-10-22)
 * The same threshold drives the low-battery status lock (#232, techaid-server#264),
 * so a battery shown red here is one that is blocked there.
 * The colour comes from the `bgcolor` expression on the batteryHealth field in
 * kit-info.component.ts and is painted on `.kit-info-input` by custom-kit-info-input.ts.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const KIT = {
  id: 2131,
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
  serialNo: 'SN-2131',
  storageCapacity: 256,
  typeOfStorage: 'SSD',
  ramCapacity: 16,
  cpuType: 'i7',
  cpuCores: 4,
  tpmVersion: '2.0',
  batteryHealth: null as number | null,
  lotId: null,
  locationCode: 'A1',
  donor: null,
  deviceRequest: null,
  notes: [],
  subStatus: {
    installationOfOSFailed: false, wipeFailed: false, needsSparePart: false,
    needsFurtherInvestigation: false, network: null, installedOSName: ['WINDOWS_11'], lockedToUser: false,
  },
};

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(255, 0, 0)';

// Mocks the API, opens the kit form, and returns the Battery Health field.
async function openKitWithBattery(page: Page, batteryHealth: number | null) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    const json = (o: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (body.includes('buildInfo')) return json({ data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
    if (body.includes('findKit')) return json({ data: { kit: { ...KIT, batteryHealth } } });
    return json({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
  });
  await page.goto(`/dashboard/devices/${KIT.id}`);
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  return page.locator('formly-field-kit-info-input').filter({ hasText: 'Battery Health' });
}

test.describe('kit-info Battery Health colour bands (#231) @mocked', () => {
  const CASES: Array<[number | null, string, string]> = [
    [51, GREEN, 'just above 50 is green'],
    [50, RED, 'exactly 50 is red'],
    [49, RED, 'below 50 is red'],
    [0, RED, '0 is red'],
    [null, RED, 'empty is red'],
  ];

  for (const [value, colour, title] of CASES) {
    test(`${title} (${value})`, async ({ page }) => {
      const battery = await openKitWithBattery(page, value);
      await expect(battery.locator('.kit-info-input')).toHaveCSS('background-color', colour);
    });
  }

  test('colour updates live when the value is edited across the threshold', async ({ page }) => {
    const battery = await openKitWithBattery(page, 51);
    const box = battery.locator('.kit-info-input');
    await expect(box).toHaveCSS('background-color', GREEN);

    await battery.locator('i.fa-edit').click();
    await page.getByRole('button', { name: 'YES, EDIT' }).click();
    await battery.locator('input').fill('50');
    await battery.locator('input').blur();
    await expect(box).toHaveCSS('background-color', RED);
  });
});
