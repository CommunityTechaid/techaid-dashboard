/**
 * Regression: editing "TPM Version" on a device record and pressing Save errored.
 *
 * Root cause: the field was a `type: "number"` kit-info-input, whose change handler
 * coerces every value with parseInt(). The server schema (techaid-server
 * kits.graphqls, UpdateKitInput.tpmVersion) declares `tpmVersion: String`, so the
 * mutation carried a JSON number for a String input and graphql-java rejected it
 * ("... Expected a String input, but it was a 'Integer'"). parseInt would also have
 * truncated real TPM versions such as "1.2" / "2.0".
 *
 * The schema-faithful mock below mimics the server's coercion rule: a non-string
 * value for a `String` input field returns that error (HTTP 200 + errors) instead of
 * echoing the client's variables back, so this spec cannot be fooled by a lenient mock.
 */
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
  tpmVersion: null, // String in the schema
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

test.describe('kit-info TPM Version edit and save @mocked', () => {
  test('TPM Version is sent as a String (per kits.graphqls) and saves cleanly', async ({ page }) => {
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
        // Server-side variable coercion for `tpmVersion: String`.
        if (data.tpmVersion != null && typeof data.tpmVersion !== 'string') {
          serverError = `Variable 'data' has an invalid value: Expected a String input, but it was a '${Number.isInteger(data.tpmVersion) ? 'Integer' : 'Float'}'`;
          return json({ errors: [{ message: serverError }], data: null });
        }
        return json({ data: { updateKit: { ...KIT, ...data, subStatus: { ...KIT.subStatus, ...(data.subStatus || {}) } } } });
      }
      return json({ data: { donorsConnection: { content: [] }, deviceRequestsConnection: { content: [] } } });
    });

    await page.goto('/dashboard/devices/2129');
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    const tpm = page.locator('formly-field-kit-info-input').filter({ hasText: 'TPM Version' });
    await tpm.locator('i.fa-edit').click();
    await page.getByRole('button', { name: 'YES, EDIT' }).click();
    await tpm.locator('input').fill('2.0');
    await tpm.locator('input').blur();

    await page.locator('button:has-text("Save")').first().click();
    await expect.poll(() => sent.length, { timeout: 5_000 }).toBeGreaterThan(0);

    expect(typeof sent[0].tpmVersion, 'tpmVersion must be a string').toBe('string');
    expect(sent[0].tpmVersion).toBe('2.0');
    expect(serverError).toBeNull();
    await expect(page.getByText('Successfully updated device')).toBeVisible({ timeout: 5_000 });
  });
});
