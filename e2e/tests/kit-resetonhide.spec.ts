/**
 * Regression: kit-info conditional (hideExpression) fields must NOT lose their
 * stored value when the field is momentarily hidden and shown again.
 *
 * ngx-formly v7 defaults to `resetOnHide: true`: when a field's hideExpression
 * flips to hidden, formly scrubs its value out of the model (and removes the
 * control). If the field is later shown again it comes back with its
 * defaultValue ('' here), NOT the persisted value. The five `subStatus.*` lock
 * checkboxes were already fixed with `resetOnHide: false`, but the value-bearing
 * hardware-attribute fields (typeOfStorage, storageCapacity, tpmVersion,
 * batteryHealth, subStatus.network, subStatus.installedOSName) were missed.
 *
 * Repro exercised here: load a LAPTOP kit that has those attributes populated,
 * toggle the device `type` to a type that hides them (OTHER hides all four
 * hardware fields + installedOSName), then back to LAPTOP. Without the fix the
 * next Save persists blanks because Formly already scrubbed the model.
 *
 * Fully page.route-mocked — same KIT_BASE / mock-installer approach as
 * kit-locked-status.spec.ts, no live API dependency.
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

const SUBSTATUS = {
  installationOfOSFailed: false,
  wipeFailed: false,
  needsSparePart: false,
  needsFurtherInvestigation: false,
  network: null,
  installedOSName: ['WINDOWS_11'],
  lockedToUser: false,
};

async function installGraphqlMocks(
  page: import('@playwright/test').Page,
  capturedMutations?: { body: any }[],
) {
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
        body: JSON.stringify({ data: { kit: { ...KIT_BASE, subStatus: { ...SUBSTATUS } } } }),
      });
      return;
    }
    if (body.includes('updateKit')) {
      let parsed: any = null;
      try { parsed = JSON.parse(body); } catch {}
      if (parsed && capturedMutations) capturedMutations.push({ body: parsed });
      const sent = parsed?.variables?.data ?? {};
      const merged = { ...KIT_BASE, ...sent, subStatus: { ...SUBSTATUS, ...(sent.subStatus || {}) } };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { updateKit: merged } }),
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

// The device `type` control is a kit-info-input rendering a <select> that is
// `[hidden]` until the edit pencil is clicked. We drive the underlying control
// directly with force:true (bypasses the visibility check) so we don't have to
// juggle the "Are you sure you want to edit?" confirm dialog. Its <select> is
// uniquely identified by carrying an <option value="LAPTOP">.
function typeSelect(page: import('@playwright/test').Page) {
  return page
    .locator('formly-field-kit-info-input')
    .filter({ has: page.locator('option[value="LAPTOP"]') })
    .locator('select');
}

test.describe('kit-info conditional-field value retention @mocked', () => {
  test('toggling device type away and back keeps hardware attributes on Save', async ({ page }) => {
    test.setTimeout(60_000);
    const captured: { body: any }[] = [];
    await installGraphqlMocks(page, captured);

    await page.goto('/dashboard/devices/2129');
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    // The Storage Type field is visible for a LAPTOP on first load.
    await expect(page.getByText('Storage Type')).toBeVisible({ timeout: 10_000 });

    // Flip type to OTHER — hides typeOfStorage, storageCapacity, tpmVersion,
    // batteryHealth and installedOSName.
    await typeSelect(page).selectOption('OTHER', { force: true });
    await expect(page.getByText('Storage Type')).toBeHidden({ timeout: 5_000 });

    // Flip back to LAPTOP — the fields re-appear.
    await typeSelect(page).selectOption('LAPTOP', { force: true });
    await expect(page.getByText('Storage Type')).toBeVisible({ timeout: 5_000 });

    // Save and capture the outgoing updateKit mutation.
    await page.locator('button:has-text("Save")').first().click();
    await expect.poll(() => captured.length, { timeout: 5_000 }).toBeGreaterThan(0);

    const sentData = captured[0].body?.variables?.data;
    expect(sentData, 'mutation must carry a data variable').toBeTruthy();

    // These four must survive the hide/show round-trip. Without the fix Formly
    // has scrubbed them and re-seeded the controls with the '' defaultValue
    // (numbers get coerced to null by the kit-info-input change handler).
    expect(sentData.typeOfStorage, 'typeOfStorage must be retained').toBe('SSD');
    expect(sentData.storageCapacity, 'storageCapacity must be retained').toBe(256);
    expect(sentData.tpmVersion, 'tpmVersion must be retained').toBe(2);
    expect(sentData.batteryHealth, 'batteryHealth must be retained').toBe(85);
  });
});
