/**
 * A referee (referring-organisation contact) save must never send a null `referringOrganisationId`.
 * The server declares it `@NotNull Long` on UpdateReferringOrganisationContactInput, so a null makes the
 * whole mutation fail with "Failed to instantiate ... Illegal arguments" (prod, 2026-11-10).
 *
 * @mocked — every GraphQL operation is page.route-stubbed; a fake JWT carries the permissions.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';
const ORG = { id: 913, name: 'REQUIRED-ORG' };

const referee = (org: unknown) => ({
  id: 912, fullName: 'REQUIRED-ORG-REFEREE', email: 'a@example.org', phoneNumber: '07700900000',
  address: '1 Test Street', createdAt: TS, updatedAt: TS, archived: false, notes: [], referringOrganisation: org,
});

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, org: unknown, sent: any[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('query findReferringOrganisationContact')) return fulfill(route, { referringOrganisationContact: referee(org) });
    if (body.includes('findAutocompleteReferringOrganisations')) return fulfill(route, { referringOrganisationsPublic: [ORG] });
    if (body.includes('mutation updateReferringOrganisation')) {
      sent.push(JSON.parse(body).variables.data);
      return fulfill(route, { updateReferringOrganisationContact: referee(ORG) });
    }
    return fulfill(route, {});
  });
}

async function open(page: Page): Promise<void> {
  await loginWith(page, ['read:organisations', 'read:referees', 'write:referees']);
  await page.goto('/dashboard/referring-organisation-contacts/912');
  await expect(page.getByLabel('Full Name').first()).toHaveValue('REQUIRED-ORG-REFEREE', { timeout: 30_000 });
}

test.describe('referee contact keeps an organisation @mocked', () => {
  test('saving an unchanged assigned referee sends the organisation id', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, ORG, sent);
    await open(page);
    await page.locator('[data-testid="contact-save"]').click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    expect(sent[0].referringOrganisationId).toBe(ORG.id);
  });

  test('clearing the organisation and saving sends no mutation and shows a message', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, ORG, sent);
    await open(page);
    await page.locator('form-choice .ng-clear-wrapper').click();
    await page.locator('[data-testid="contact-save"]').click();
    await page.waitForTimeout(1500);
    expect(sent, 'no mutation may be sent without an organisation').toHaveLength(0);
    await expect(page.locator('.invalid-feedback').first()).toBeVisible();
  });

  test('a referee with no organisation cannot be saved until one is chosen', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, null, sent);
    await open(page);
    await page.locator('[data-testid="contact-save"]').click();
    await page.waitForTimeout(1500);
    expect(sent, 'no mutation may be sent without an organisation').toHaveLength(0);
    await expect(page.locator('.invalid-feedback').first()).toBeVisible();
  });
});
