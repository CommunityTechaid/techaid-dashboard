/**
 * Regression: kit-info Save button must give clear feedback when required
 * fields are empty (issue #49).
 *
 * Before the fix, the Save button was bound to `[disabled]="form.invalid"`, so
 * an empty mandatory field (e.g. `subStatus.network` on a SMARTPHONE) silently
 * disabled the button. A volunteer trying to save device 20031 → request 6526
 * saw "the button does not appear to work" with no explanation.
 *
 * After the fix:
 *   - Save remains clickable even when the form is invalid.
 *   - Clicking it on an invalid form shows an error toast naming the missing
 *     required fields and does NOT fire the updateKit mutation.
 *   - Clicking it on a valid form still fires updateKit as before.
 */
import { test, expect } from '@playwright/test';

const KIT_BASE = {
  id: 20031,
  type: 'SMARTPHONE',
  status: 'PROCESSING_OS_INSTALLED',
  model: 'Pixel 6',
  location: 'BANK',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  age: 3,
  archived: false,
  make: 'Google',
  deviceVersion: null,
  serialNo: 'SN-20031',
  storageCapacity: 128,
  typeOfStorage: 'SSD',
  ramCapacity: 8,
  cpuType: 'Tensor',
  cpuCores: 8,
  tpmVersion: 0,
  batteryHealth: 90,
  lotId: null,
  locationCode: 'A1',
  donor: null,
  deviceRequest: null,
  attributes: { credentials: '', status: '', notes: '', network: '', state: '', otherType: '' },
  notes: [],
};

const SUBSTATUS_EMPTY_NETWORK = {
  installationOfOSFailed: false,
  wipeFailed: false,
  needsSparePart: false,
  needsFurtherInvestigation: false,
  network: null,
  installedOSName: [],
  lockedToUser: false,
};

const SUBSTATUS_WITH_NETWORK = {
  ...SUBSTATUS_EMPTY_NETWORK,
  network: 'UNLOCKED',
};

async function installGraphqlMocks(
  page: import('@playwright/test').Page,
  subStatus: any,
  capturedMutations: { body: any }[],
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
        body: JSON.stringify({ data: { kit: { ...KIT_BASE, subStatus } } }),
      });
      return;
    }
    if (body.includes('updateKit')) {
      let parsed: any = null;
      try { parsed = JSON.parse(body); } catch {}
      if (parsed) capturedMutations.push({ body: parsed });
      const sent = parsed?.variables?.data ?? {};
      const merged = { ...KIT_BASE, ...sent, subStatus: { ...subStatus, ...(sent.subStatus || {}) } };
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

test('Save on invalid form: surfaces an error toast and does not fire updateKit', async ({ page }) => {
  test.setTimeout(60_000);
  const captured: { body: any }[] = [];
  await installGraphqlMocks(page, SUBSTATUS_EMPTY_NETWORK, captured);

  await page.goto('/dashboard/devices/20031');
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2000);

  // The form is invalid (subStatus.network is required for SMARTPHONE and unset).
  // Pre-fix: button is disabled, the click is a no-op, no toast appears.
  // Post-fix: the click runs updateEntity which surfaces a toast and aborts the mutation.
  await page.locator('button:has-text("Save")').first().click({ force: true });
  await page.waitForTimeout(1500);

  // Toast must be visible with copy that names the missing-fields condition.
  const toast = page.locator('.toast-error, [role="alert"]').filter({ hasText: /required fields/i }).first();
  await expect(toast, 'an error toast should explain that required fields are incomplete').toBeVisible({ timeout: 5_000 });

  expect(captured.length, 'updateKit must NOT fire when the form is invalid').toBe(0);
});

test('Save on valid form: still fires updateKit', async ({ page }) => {
  test.setTimeout(60_000);
  const captured: { body: any }[] = [];
  await installGraphqlMocks(page, SUBSTATUS_WITH_NETWORK, captured);

  await page.goto('/dashboard/devices/20031');
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(2000);

  await page.locator('button:has-text("Save")').first().click();
  await page.waitForTimeout(1500);

  expect(captured.length, 'updateKit should fire on a valid form').toBeGreaterThan(0);
});
