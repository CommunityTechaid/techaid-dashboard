/**
 * Kit `attributes` is retired from the API (techaid-server #151, #222). The server no longer
 * declares `Kit.attributes`, `KitWhereInput.attributes` or the `attributes` inputs, so any
 * document that still mentions the field fails validation and the page breaks. The kit list
 * search used to send an `attributes.filters` notes clause, and kit-info selected
 * `attributes { ... }` on load and on save.
 *
 * This spec captures every GraphQL request the kit list and kit detail pages send (load,
 * search, save) and asserts that none mentions `attributes`.
 */
import { test, expect } from '../helpers/csp';

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
  tpmVersion: null,
  batteryHealth: 85,
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

test.describe('kit attributes are retired @mocked', () => {
  test('kit list, search, detail and save never send attributes', async ({ page }) => {
    test.setTimeout(60_000);
    const bodies: string[] = [];

    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      bodies.push(body);
      const json = (o: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (body.includes('buildInfo')) return json({ data: { buildInfo: { version: 't', commit: 'c', time: '2026-01-01T00:00:00Z' } } });
      if (body.includes('findAllKits')) {
        return json({ data: { kitsConnection: { totalElements: 1, number: 0, content: [KIT] } } });
      }
      if (body.includes('findKit')) return json({ data: { kit: KIT } });
      if (body.includes('updateKit')) {
        const data = JSON.parse(body).variables?.data ?? {};
        return json({ data: { updateKit: { ...KIT, ...data, subStatus: { ...KIT.subStatus, ...(data.subStatus || {}) } } } });
      }
      return json({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
    });

    // Kit list, then a free-text search (the search document is the one that carried the clause).
    await page.goto('/dashboard/devices');
    await expect.poll(() => bodies.some(b => b.includes('findAllKits')), { timeout: 30_000 }).toBe(true);
    const search = page.locator('input[type="search"]').first();
    if (await search.isVisible()) {
      await search.fill('ThinkPad');
      await expect.poll(() => bodies.filter(b => b.includes('findAllKits') && b.includes('ThinkPad')).length, { timeout: 10_000 })
        .toBeGreaterThan(0);
    }

    // Kit detail load and save.
    await page.goto('/dashboard/devices/2129');
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('button:has-text("Save")').first().click();
    await expect.poll(() => bodies.some(b => b.includes('updateKit')), { timeout: 10_000 }).toBe(true);

    const offenders = bodies.filter(b => b.includes('attributes'));
    expect(offenders, `GraphQL requests still mention attributes:\n${offenders.join('\n---\n')}`).toEqual([]);
  });
});
