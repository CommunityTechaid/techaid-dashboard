/**
 * Issue #232: the device form locks the three ALLOCATION_* statuses when Battery Health is
 * 50% or below, or empty, on a laptop, tablet or smartphone, and says why.
 * It mirrors the server guard (techaid-server#264, BatteryHealthGuardService), which is the
 * real enforcement; this lock tells staff up front instead of after a rejected save.
 *   - Threshold: BATTERY_HEALTH_OK_ABOVE (50), shared with the #231 colour coding.
 *   - DISTRIBUTION_DELIVERED is never locked by this rule (Kocycle devices, repair returns,
 *     request automation).
 *   - Empty counts as locked, matching the server. Open question on #232: if that changes,
 *     update the `null` case below together with the form.
 *   - Desktops and other types without a battery are out of scope, even though they show red.
 * Kept separate from the sub-status flag lock (kit-locked-status.spec.ts), which disables
 * the whole status field.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const KIT = {
  id: 2132,
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
  serialNo: 'SN-2132',
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

// The three statuses the rule locks, in the order the form lists them.
const LOCKED = ['ALLOCATION_READY', 'ALLOCATION_QC_COMPLETED', 'ALLOCATION_DELIVERY_ARRANGED'];
const NOTE = 'Battery health too low, please see guide for next steps';

// Mocks the API and opens the kit form for a device of this type and battery reading.
async function openKit(page: Page, type: string, batteryHealth: number | null) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    const json = (o: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (body.includes('buildInfo')) return json({ data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
    if (body.includes('findKit')) return json({ data: { kit: { ...KIT, type, batteryHealth } } });
    return json({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
  });
  await page.goto(`/dashboard/devices/${KIT.id}`);
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('label:has-text("Status of the device")').waitFor({ state: 'visible', timeout: 10_000 });
}

// The values of the status radios that are disabled.
function disabledStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('label'))
      .find(l => (l.textContent || '').includes('Status of the device'));
    const field = label?.closest('formly-field');
    const radios = field ? Array.from(field.querySelectorAll<HTMLInputElement>('input[type="radio"]')) : [];
    return radios.filter(r => r.disabled).map(r => r.value);
  });
}

test.describe('kit-info battery status lock (#232) @mocked', () => {
  // [device type, battery health, locked?, title]
  const CASES: [string, number | null, boolean, string][] = [
    ['LAPTOP', 51, false, 'laptop at 51 is not locked'],
    ['LAPTOP', 50, true, 'laptop at exactly 50 is locked'],
    ['LAPTOP', 40, true, 'laptop at 40 locks only the three allocation statuses, not DISTRIBUTION_DELIVERED'],
    ['LAPTOP', 0, true, 'laptop at 0 is locked'],
    ['LAPTOP', null, true, 'laptop with no reading is locked'],
    ['LAPTOP', 103, false, 'laptop over 100 is not locked'],
    ['SMARTPHONE', 40, true, 'smartphone at 40 is locked'],
    ['DESKTOP', null, false, 'desktop with no reading is out of scope'],
  ];

  for (const [type, battery, locked, title] of CASES) {
    test(title, async ({ page }) => {
      await openKit(page, type, battery);
      if (locked) {
        // toEqual(LOCKED) is exact, so DISTRIBUTION_DELIVERED (and every other status) stays enabled.
        await expect.poll(() => disabledStatuses(page), { timeout: 5_000 }).toEqual(LOCKED);
        await expect(page.getByText(NOTE)).toBeVisible();
      } else {
        await expect.poll(() => disabledStatuses(page), { timeout: 5_000 }).toEqual([]);
        await expect(page.getByText(NOTE)).toBeHidden();
      }
    });
  }

  test('raising the battery to 51 unlocks the statuses without saving', async ({ page }) => {
    await openKit(page, 'LAPTOP', 40);
    await expect.poll(() => disabledStatuses(page), { timeout: 5_000 }).toEqual(LOCKED);

    const battery = page.locator('formly-field-kit-info-input').filter({ hasText: 'Battery Health' });
    await battery.locator('i.fa-edit').click();
    await page.getByRole('button', { name: 'YES, EDIT' }).click();
    await battery.locator('input').fill('51');
    await battery.locator('input').blur();

    await expect.poll(() => disabledStatuses(page), { timeout: 5_000 }).toEqual([]);
    await expect(page.getByText(NOTE)).toBeHidden();
  });
});
