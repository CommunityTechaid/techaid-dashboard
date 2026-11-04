/**
 * Mocked coverage for sheet item 27 (dashboard #279 / techaid-server #336): the request-cap page
 * is shown straight after the referee lookup when `requestLimitStatus.atLimit` is true, instead of
 * after the whole form has been filled in and submitted.
 *
 * The lookup stub returns the public `requestLimitStatus { atLimit limit }` field (no open count,
 * by design). The submit-time refusal is still the backstop and is covered by
 * streamlined-ward-lookup.spec.ts.
 *
 * @mocked: all GraphQL stubbed, no token needed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';
const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark

type LookupMode = 'at-limit' | 'under-limit' | 'old-server' | 'null-status';

interface Captured {
  lookupVariables: any[];
  createCalls: number;
}

async function installMocks(page: Page, mode: LookupMode): Promise<Captured> {
  const captured: Captured = { lookupVariables: [], createCalls: 0 };

  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );
  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
  );

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({
        data: { featureFlagsPublic: [{ key: 'tower-hamlets-borough-support', enabled: true }] },
      });
    }
    if (raw.includes('boroughAvailabilityPublic')) {
      const everything = ['laptops', 'desktops', 'tablets', 'phones', 'allInOnes', 'commsDevices', 'broadbandHubs', 'other'];
      return json({
        data: {
          boroughAvailabilityPublic: [
            { borough: 'Southwark', offered: everything, maxPerReferee: 3, unresolvedAuto: [] },
          ],
        },
      });
    }
    if (raw.includes('adminConfig')) {
      return json({
        data: {
          adminConfig: {
            canPublicRequestSIMCard: true,
            canPublicRequestLaptop: true,
            canPublicRequestPhone: true,
            canPublicRequestBroadbandHub: true,
            canPublicRequestTablet: true,
            canPublicRequestDesktop: true,
          },
        },
      });
    }
    if (raw.includes('findContent')) {
      return json({ data: { post: { id: '1', content: '<p>E2E public request page content</p>' } } });
    }
    if (raw.includes('findAutocompleteReferringOrgs')) {
      return json({ data: { referringOrganisationsPublic: [{ id: 'org-1', name: 'E2E Test Org' }] } });
    }
    if (raw.includes('findOrganisationContact')) {
      captured.lookupVariables.push(JSON.parse(raw).variables);
      const hasField = raw.includes('requestLimitStatus');
      if (mode === 'old-server' && hasField) {
        return json({
          errors: [
            {
              message:
                "Validation error (FieldUndefined@[referringOrganisationContactsPublic/requestLimitStatus]) : Field 'requestLimitStatus' in type 'ReferringOrganisationContactPublic' is undefined",
            },
          ],
        });
      }
      const contact: any = { id: 'contact-1', fullName: 'E2E Contact' };
      if (hasField && mode === 'at-limit') contact.requestLimitStatus = { atLimit: true, limit: 3 };
      if (hasField && mode === 'under-limit') contact.requestLimitStatus = { atLimit: false, limit: 3 };
      if (hasField && mode === 'null-status') contact.requestLimitStatus = null;
      return json({ data: { referringOrganisationContactsPublic: [contact] } });
    }
    if (raw.includes('createDeviceRequest')) {
      captured.createCalls++;
    }
    return json({ data: {} });
  });

  return captured;
}

/** Postcode (Southwark) -> org -> email -> Find Email. */
async function runLookup(page: Page): Promise<void> {
  await page.goto('/organisation-device-request');
  await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

  await expect(page.locator('#postcode')).toBeVisible({ timeout: 15_000 });
  await page.locator('#postcode').fill(COVERED_POSTCODE);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit a request' }).click();

  const orgSelectInput = page.locator('form-choice ng-select input');
  await expect(orgSelectInput).toBeVisible({ timeout: 15_000 });
  await orgSelectInput.fill('E2E');
  const orgOption = page.locator('.ng-option', { hasText: 'E2E Test Org' });
  await expect(orgOption).toBeVisible({ timeout: 15_000 });
  await orgOption.click();

  await page.getByPlaceholder('Your email address').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Find Email' }).click();
}

test.describe('request cap shown before the request form @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a referee at the cap sees the cap page before the request page', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, 'at-limit');

    await runLookup(page);

    await expect(page.getByText('Oops!')).toBeVisible({ timeout: 15_000 });
    const banner = page.locator('.cta-alert.cta-alert-danger');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/cta-alert/);
    await expect(banner).toContainText('The limit is 3.');
    // The request form was never reached, and nothing was submitted.
    await expect(page.getByText('Please select the item your client needs.')).toHaveCount(0);
    expect(captured.createCalls).toBe(0);
    // The borough chosen at the postcode step is sent with the lookup.
    expect(captured.lookupVariables[0].borough).toBe('Southwark');
  });

  test('a referee under the cap proceeds to the request page as normal', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, 'under-limit');

    await runLookup(page);

    await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Oops!')).toHaveCount(0);
  });

  test('an old server without the field falls through to the normal flow', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, 'old-server');

    await runLookup(page);

    await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Oops!')).toHaveCount(0);
  });

  test('a null requestLimitStatus falls through to the normal flow', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, 'null-status');

    await runLookup(page);

    await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Oops!')).toHaveCount(0);
  });
});
