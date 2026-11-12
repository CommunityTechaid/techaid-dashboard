/**
 * Creating a parent donor must work after the Address field's clear (X) button was used. The shared
 * place field's X sets the control to null, but the server's CreateDonorParentInput.address is a
 * non-null Kotlin String (no default), so `address: null` failed object construction and staff saw a
 * raw instantiation error toast. donor-parent-index now sends '' for a cleared address — what an
 * untouched field already sent. The shared place component still sets null (other forms rely on it).
 *
 * The createDonorParent mock mirrors the server: a null address is answered with a GraphQL error.
 *
 * @mocked — every GraphQL operation is page.route-stubbed and the Places proxy is stubbed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { stubPlacesProxy } from '../helpers/places-proxy';

const TS = '2026-01-01T00:00:00Z';
const NAME = 'ADDRESS-CLEARED-PARENT';

async function fulfill(route: Route, data: unknown, errors?: unknown[]): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(errors ? { data, errors } : { data }) });
}

async function installMocks(page: Page, sent: any[]): Promise<{ created: () => boolean }> {
  let created = false;
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('query findAllDonorParents')) {
      const content = created ? [{
        id: 951, name: NAME, address: '', website: 'https://example.org', donorCount: 0, type: 'DROPPOINT',
        createdAt: TS, updatedAt: TS, archived: false, donors: [],
      }] : [];
      return fulfill(route, { donorParentsConnection: { totalElements: content.length, content } });
    }
    if (body.includes('mutation createDonorParent')) {
      const data = JSON.parse(body).variables.data;
      sent.push(data);
      if (data.address === null || data.address === undefined) {
        // What the server does: CreateDonorParentInput.address is a non-null Kotlin String.
        return fulfill(route, null, [{ message: 'Failed to instantiate CreateDonorParentInput: Illegal arguments', path: ['createDonorParent'] }]);
      }
      created = true;
      return fulfill(route, { createDonorParent: { id: 951, name: data.name, address: data.address, website: data.website, type: data.type } });
    }
    return fulfill(route, {});
  });
  return { created: () => created };
}

test.describe('create parent donor after clearing the address @mocked', () => {
  test('a cleared address is sent as an empty string and the parent donor is created', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await stubPlacesProxy(page);
    const state = await installMocks(page, sent);

    await page.goto('/dashboard/donor-parents');
    await page.locator('a.btn-primary:has-text("Create Parent Donor")').click();
    const modal = page.locator('ngb-modal-window');
    await expect(modal.locator('.modal-title', { hasText: 'New Parent Donor' })).toBeVisible({ timeout: 15_000 });

    await modal.getByLabel('Name').first().fill(NAME);
    await modal.getByLabel('Website').first().fill('https://example.org');
    const address = modal.locator('form-place input');
    await address.fill('1 Cleared Street');
    await modal.locator('form-place button').click();
    await expect(address).toHaveValue('');

    await modal.locator('.modal-footer button', { hasText: 'CREATE' }).click();

    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    expect(sent[0].address, 'a cleared address must be sent as an empty string, not null').toBe('');
    expect(sent[0].name).toBe(NAME);
    await expect.poll(() => state.created(), { timeout: 5_000 }).toBe(true);
    // Success path: the table reloads and shows the new parent donor; no create-error toast.
    await expect(page.locator('cta-table').getByText(NAME)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.toast-error', { hasText: 'Create Parent Donor Error' })).toHaveCount(0);
  });
});
