import { test, expect } from '@playwright/test';

const KIT = {
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
  tpmVersion: '2.0',
  batteryHealth: 85,
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

test.describe('Battery Health background @mocked', () => {
  for (const [health, colour] of [
    [49, 'rgb(255, 0, 0)'],
    [50, 'rgb(255, 0, 0)'],
    [51, 'rgb(0, 128, 0)'],
    [0, 'rgb(255, 0, 0)'],
    ['', 'rgb(255, 0, 0)'],
    [null, 'rgb(255, 0, 0)'],
  ] as const) {
    test(`${JSON.stringify(health)} displays ${colour}`, async ({ page }) => {
      await page.route('**/graphql', async route => {
        const body = route.request().postData() ?? '';
        const data = body.includes('buildInfo')
          ? { buildInfo: { version: 'test', commit: 'test', time: '2026-01-01T00:00:00Z' } }
          : body.includes('findKit')
            ? { kit: { ...KIT, batteryHealth: health } }
            : { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
      });

      await page.goto('/dashboard/devices/2129');
      const battery = page.locator('formly-field-kit-info-input').filter({ hasText: 'Battery Health' });
      await expect(battery).toBeVisible();
      await expect(battery.locator('.kit-info-input')).toHaveCSS('background-color', colour);
    });
  }
});
