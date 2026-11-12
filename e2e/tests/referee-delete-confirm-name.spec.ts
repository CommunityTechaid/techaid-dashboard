/**
 * The referee delete confirmation must name the referee being deleted.
 *
 * The modal template read `{{name}}`, a field the component never had (the name lives in the
 * `fullName` signal), so it rendered `delete ""` — staff confirmed a destructive action without
 * being told whose record it was.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; a fake JWT carries the permissions.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';

const REFEREE = {
  id: 912, fullName: 'DELETE-CONFIRM-REFEREE', email: 'a@example.org', phoneNumber: '07700900000', address: '',
  createdAt: TS, updatedAt: TS, archived: false, notes: [],
  referringOrganisation: { id: 913, name: 'DELETE-CONFIRM-ORG' },
};

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    }
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('query findReferringOrganisationContact')) {
      return fulfill(route, { referringOrganisationContact: REFEREE });
    }
    return fulfill(route, {});
  });
}

test.describe('referee delete confirmation @mocked', () => {
  test('names the referee being deleted', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await loginWith(page, ['read:organisations', 'read:referees', 'delete:referees', 'app:bulkedit']);
    await page.goto('/dashboard/referring-organisation-contacts/912');
    await expect(page.locator('formly-form').first().getByLabel('Full Name').first())
      .toHaveValue(REFEREE.fullName, { timeout: 30_000 });

    await page.locator('[data-testid="contact-delete-open"]').click();
    const modal = page.locator('.modal-body');
    await expect(modal).toBeVisible();
    await expect(modal.locator('strong')).toHaveText(REFEREE.fullName);

    // Cancel — nothing is deleted.
    await page.getByRole('button', { name: 'CANCEL' }).click();
    await expect(modal).toHaveCount(0);
  });
});
