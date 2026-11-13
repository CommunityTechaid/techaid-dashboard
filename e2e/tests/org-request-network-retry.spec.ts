/**
 * The public request form retries a submit that failed because the API could not be reached
 * (the API scales to zero and cold-starts, e.g. 08:00 on weekdays): it shows "Waking up the
 * server", polls until the API answers, then sends createDeviceRequest again.
 *
 * Regression: parseApolloError put `errorText(error)` into its list of message sources. For a
 * transport failure that text is never empty (Angular's "Http failure response for ...: 0 Unknown
 * Error", or Apollo's "Response not successful: Received status code 503"), so the "has a message"
 * branch always won, `isNetwork` was never true, and the wake-up retry never ran: the user got an
 * error toast on the first refused connection.
 *
 * What it pins: an aborted first submit and an HTTP 503 first submit are each retried once, and
 * the second (successful) attempt carries on to the equalities step. A GraphQL business error is
 * still NOT retried (device-type-not-offered-inline.spec.ts and the limit specs cover those paths).
 *
 * @mocked: all GraphQL stubbed, no token needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';
const TYPEFORM_ORIGIN = '**://embed.typeform.com/**';
const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark

type FirstFailure = (route: Route) => Promise<void>;

async function installMocks(page: Page, firstFailure: FirstFailure): Promise<{ createCalls: number }> {
  const captured = { createCalls: 0 };

  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );
  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
  );
  await page.route(TYPEFORM_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

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
      if (captured.createCalls === 1) {
        return firstFailure(route);
      }
      return json({ data: { createDeviceRequest: { id: '4242', correlationId: 'corr-e2e', membershipGraceIndex: null } } });
    }
    return json({ data: {} });
  });

  return captured;
}

/** Postcode -> org -> email -> request page, filled so it is submittable. */
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

async function expectRetried(page: Page, captured: { createCalls: number }): Promise<void> {
  await expect.poll(() => captured.createCalls, { timeout: 15_000 }).toBeGreaterThan(0);
  // Before the fix the first failure went straight to an error toast instead of the retry.
  await expect(page.locator('.toast-error'), 'a transport failure must not end in an error toast').toHaveCount(0, { timeout: 2_000 });
  await expect(page.locator('.toast-info', { hasText: 'Waking up the server' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => captured.createCalls, { timeout: 30_000 }).toBe(2);
  await expect(page.locator('.toast-info', { hasText: 'Please fill in the equalities data' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.toast-error')).toHaveCount(0);
}

test.describe('public request form retries when the API is waking up @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a refused connection on submit is retried once the API answers', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, route => route.abort('connectionrefused'));
    await fillSubmittableRequest(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await expectRetried(page, captured);
  });

  test('an HTTP 503 on submit is retried once the API answers', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: '<html><body>Service Unavailable</body></html>' }),
    );
    await fillSubmittableRequest(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await expectRetried(page, captured);
  });
});
