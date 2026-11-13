/**
 * A referee (referring-organisation contact) save must never send a blank `email`. The server declares
 * it `@NotBlank @Email` on UpdateReferringOrganisationContactInput, so an emptied Email field used to
 * send '' and the whole save failed with a raw "must not be blank" error toast. The field is now
 * required on the client: Save shows the field-level message and sends nothing.
 *
 * Exception: a GDPR-erased contact (fullName is the server's erasure marker; email, phone and address
 * are all '') must stay saveable, because staff archive / un-archive erased referees from this form and
 * it sends the whole record back. Its email and address are not required.
 *
 * Same shape as referee-contact-org-required.spec.ts (#373).
 *
 * @mocked — every GraphQL operation is page.route-stubbed; a fake JWT carries the permissions.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';
const ORG = { id: 923, name: 'EMAIL-REQUIRED-ORG' };
const NAME = 'EMAIL-REQUIRED-REFEREE';
const EMAIL = 'referee@example.org';
// Mirrors the server's ReferringOrganisationContact.GDPR_ERASED_NAME.
const ERASED_NAME = 'Contact - Erased due to GDPR policy';

interface Contact { fullName: string; email: string; phoneNumber: string; address: string; archived: boolean }

const LIVE: Contact = { fullName: NAME, email: EMAIL, phoneNumber: '07700900000', address: '1 Test Street', archived: false };
const ERASED: Contact = { fullName: ERASED_NAME, email: '', phoneNumber: '', address: '', archived: false };

const referee = (c: Contact) => ({
  id: 922, ...c, createdAt: TS, updatedAt: TS, notes: [], referringOrganisation: ORG,
});

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, contact: Contact, sent: any[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('query findReferringOrganisationContact')) return fulfill(route, { referringOrganisationContact: referee(contact) });
    if (body.includes('findAutocompleteReferringOrganisations')) return fulfill(route, { referringOrganisationsPublic: [ORG] });
    if (body.includes('mutation updateReferringOrganisation')) {
      const data = JSON.parse(body).variables.data;
      sent.push(data);
      return fulfill(route, {
        updateReferringOrganisationContact: referee({
          fullName: data.fullName, email: data.email, phoneNumber: data.phoneNumber, address: data.address, archived: data.archived,
        }),
      });
    }
    return fulfill(route, {});
  });
}

async function open(page: Page, contact: Contact): Promise<void> {
  await loginWith(page, ['read:organisations', 'read:referees', 'write:referees']);
  await page.goto('/dashboard/referring-organisation-contacts/922');
  await expect(page.getByLabel('Full Name').first()).toHaveValue(contact.fullName, { timeout: 30_000 });
  await expect(page.locator('input[type="email"]')).toHaveValue(contact.email);
}

test.describe('referee email is required @mocked', () => {
  test('saving a referee with an email sends the email', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, LIVE, sent);
    await open(page, LIVE);
    await page.locator('input[type="email"]').fill('changed@example.org');
    await page.locator('[data-testid="contact-save"]').click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    expect(sent[0].email).toBe('changed@example.org');
  });

  test('emptying the email and saving sends no mutation and flags the field', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, LIVE, sent);
    await open(page, LIVE);
    const email = page.locator('input[type="email"]');
    await email.fill('');
    await page.locator('[data-testid="contact-save"]').click();
    await page.waitForTimeout(1500);
    expect(sent, 'no mutation may be sent with a blank email').toHaveLength(0);
    await expect(email).toHaveClass(/is-invalid/);
    await expect(page.locator('.invalid-feedback', { hasText: 'This field is required' }).first()).toBeVisible();
  });

  test('a GDPR-erased referee can still be archived: blank email and address do not block Save', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, ERASED, sent);
    await open(page, ERASED);
    await page.getByLabel('Archive and hide this referee').check();
    await page.locator('[data-testid="contact-save"]').click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe('');
    expect(sent[0].fullName).toBe(ERASED_NAME);
    expect(sent[0].archived).toBe(true);
    await expect(page.locator('.invalid-feedback')).toHaveCount(0);
  });
});
