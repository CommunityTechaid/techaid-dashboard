/**
 * Mocked coverage for techaid-server#369 / #367: `createDeviceRequest` now rejects a request for a
 * device type that is switched off in the public offer. The rejection is a normal GraphQL error
 * response (HTTP 200) carrying `extensions.code = "DEVICE_TYPE_NOT_OFFERED"`.
 *
 * The public form must show that inline, next to the device-type choice, in plain wording, rather
 * than raising the server's own sentence ("... Please refresh the form.") as a generic error toast.
 * Any other error keeps the existing path (a toast carrying the server's message).
 *
 * The mocked error uses the REAL server shape (DeviceRequestMutations.kt, handleDeviceTypeNotOffered):
 * ErrorType.BAD_REQUEST -> `extensions.classification`, plus `extensions.code`, message
 * "<Names> are not currently available in <borough>. Please refresh the form."
 *
 * @mocked: all GraphQL stubbed, no token needed.
 */
import { Locator, Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';
const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark

const SERVER_MESSAGE = 'Laptops are not currently available in Southwark. Please refresh the form.';

/** The inline message, found by role and text (template-field HTML is sanitised: no data-testid). */
function inlineMessage(scope: Locator): Locator {
  return scope.getByRole('alert').filter({ hasText: 'not currently being offered' });
}

async function installMocks(page: Page, createResponse: unknown): Promise<{ createCalls: number }> {
  const captured = { createCalls: 0 };

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

    // Without this the global "Server is starting up" interstitial replaces the page.
    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({ data: { featureFlagsPublic: [{ key: 'tower-hamlets-borough-support', enabled: true }] } });
    }
    if (raw.includes('boroughAvailabilityPublic')) {
      const everything = ['laptops', 'desktops', 'tablets', 'phones', 'allInOnes', 'commsDevices', 'broadbandHubs', 'other'];
      return json({
        data: {
          boroughAvailabilityPublic: [{ borough: 'Southwark', offered: everything, maxPerReferee: 3, unresolvedAuto: [] }],
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
      return json({ data: { referringOrganisationContactsPublic: [{ id: 'contact-1', fullName: 'E2E Contact' }] } });
    }
    if (raw.includes('createDeviceRequest')) {
      captured.createCalls++;
      return json(createResponse);
    }
    return json({ data: {} });
  });

  return captured;
}

/** Postcode -> org -> email -> request page, then fill it so it is submittable. */
async function fillSubmittableRequest(page: Page): Promise<void> {
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
  await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });

  const form = page.locator('formly-form');
  await form.getByText('Laptop', { exact: true }).click();
  await form.locator('textarea').fill('E2E test request, no identifiable details.');
  await page
    .getByLabel("For your records, enter your client's initials or a client reference")
    .fill('E2E-1');
}

test.describe('device type not offered, inline @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('DEVICE_TYPE_NOT_OFFERED shows an inline message by the device choice', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, {
      errors: [
        {
          message: SERVER_MESSAGE,
          locations: [{ line: 2, column: 3 }],
          path: ['createDeviceRequest'],
          extensions: { classification: 'BAD_REQUEST', code: 'DEVICE_TYPE_NOT_OFFERED' },
        },
      ],
      data: null,
    });

    await fillSubmittableRequest(page);
    await page.getByRole('button', { name: 'Next' }).click();

    const inline = inlineMessage(page.locator('formly-form'));
    await expect(inline).toBeVisible({ timeout: 15_000 });
    await expect(inline).toContainText('not currently being offered');
    await expect(inline).toContainText('choose a different item');

    // It sits in the same form, directly with the device-type choice: the same row as the radios.
    const choiceRow = page.locator('formly-form .row', { has: page.getByText('Please select the item your client needs.') });
    await expect(inlineMessage(choiceRow)).toBeVisible();

    // The server's own sentence ("... Please refresh the form.") is not what the user sees.
    await expect(page.getByText('Please refresh the form')).toHaveCount(0);
    await expect(page.getByText(SERVER_MESSAGE)).toHaveCount(0);

    // Not the request-cap page, and the form is still there to change the choice.
    await expect(page.getByText('Oops!')).toHaveCount(0);
    await expect(page.getByText('Please select the item your client needs.')).toBeVisible();
    expect(captured.createCalls).toBe(1);

    // Announced to assistive tech (the locator itself is by role=alert; Angular's sanitiser strips
    // data-testid from a Formly template field, so there is no test id to use).
    await expect(inline).toHaveAttribute('role', 'alert');

    // Choosing something else answers the message, so it goes away straight away.
    await page.locator('formly-form').getByText('Smartphone', { exact: true }).click();
    await expect(inline).toHaveCount(0);
  });

  test('a different error keeps the existing generic path and shows no inline message', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, {
      errors: [
        {
          message: 'Something else went wrong on the server',
          path: ['createDeviceRequest'],
          extensions: { classification: 'INTERNAL_ERROR', code: 'SOMETHING_ELSE' },
        },
      ],
      data: null,
    });

    await fillSubmittableRequest(page);
    await page.getByRole('button', { name: 'Next' }).click();

    // Existing path: the server's message is raised as an error toast.
    await expect(page.getByText('Something else went wrong on the server')).toBeVisible({ timeout: 15_000 });
    await expect(inlineMessage(page.locator('formly-form'))).toHaveCount(0);
  });
});
