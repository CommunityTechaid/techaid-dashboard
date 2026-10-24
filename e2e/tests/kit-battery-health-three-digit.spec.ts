/**
 * Battery health can legitimately exceed 100% (replacement batteries reporting a stale
 * design capacity). The HardwareInfo collector used to drop the integer part of the
 * capacity ratio, so 103% arrived in TaDa as 3 and rendered red; that was fixed in
 * HardwareInfo 899eca6. This spec pins that TaDa itself handles three-digit values:
 * they render in full, colour green, and round-trip through updateKit as an Int
 * (kits.graphqls `batteryHealth: Int`, column `integer`, no range check server-side).
 */
import { test, expect } from '@playwright/test';

const KIT = {
  id: 2130,
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
  serialNo: 'SN-2130',
  storageCapacity: 256,
  typeOfStorage: 'SSD',
  ramCapacity: 16,
  cpuType: 'i7',
  cpuCores: 4,
  tpmVersion: '2.0',
  batteryHealth: 103,
  lotId: null,
  locationCode: 'A1',
  donor: null,
  deviceRequest: null,
  attributes: { credentials: '', status: '', notes: '', network: '', state: '', otherType: '' },
  notes: [],
  subStatus: {
    installationOfOSFailed: false, wipeFailed: false, needsSparePart: false,
    needsFurtherInvestigation: false, network: null, installedOSName: ['WINDOWS_11'], lockedToUser: false,
  },
};

const GREEN = 'rgb(0, 128, 0)';

test.describe('kit-info Battery Health over 100% @mocked', () => {
  test('a three-digit battery health renders in full, is green, and saves as an Int', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    let serverError: string | null = null;

    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      const json = (o: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (body.includes('buildInfo')) return json({ data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
      if (body.includes('findKit')) return json({ data: { kit: KIT } });
      if (body.includes('updateKit')) {
        const data = JSON.parse(body).variables?.data ?? {};
        sent.push(data);
        // Server-side variable coercion for `batteryHealth: Int`.
        if (data.batteryHealth != null && !Number.isInteger(data.batteryHealth)) {
          serverError = `Variable 'data' has an invalid value: Expected an Int input, but it was '${data.batteryHealth}'`;
          return json({ errors: [{ message: serverError }], data: null });
        }
        return json({ data: { updateKit: { ...KIT, ...data, subStatus: { ...KIT.subStatus, ...(data.subStatus || {}) } } } });
      }
      return json({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
    });

    await page.goto('/dashboard/devices/2130');
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    const battery = page.locator('formly-field-kit-info-input').filter({ hasText: 'Battery Health' });
    const box = battery.locator('.kit-info-input');
    await expect(box.locator('span').first()).toHaveText('103');
    await expect(box).toHaveCSS('background-color', GREEN);

    await battery.locator('i.fa-edit').click();
    await page.getByRole('button', { name: 'YES, EDIT' }).click();
    await battery.locator('input').fill('105');
    await battery.locator('input').blur();
    await expect(box.locator('span').first()).toHaveText('105');
    await expect(box).toHaveCSS('background-color', GREEN);

    await page.locator('button:has-text("Save")').first().click();
    await expect.poll(() => sent.length, { timeout: 5_000 }).toBeGreaterThan(0);

    expect(sent[0].batteryHealth).toBe(105);
    expect(serverError).toBeNull();
    await expect(page.getByText('Successfully updated device')).toBeVisible({ timeout: 5_000 });
  });
});
