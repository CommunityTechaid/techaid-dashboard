/**
 * Membership allowance notices on the public request form (techaid-server#311).
 *
 * Once the organisation and referee email are known, the form shows the organisation's yearly
 * allowance: a warning for its last request, and — over the limit — whichever behaviour the
 * server's `adminConfig.membershipOverLimitMode` selects. GRACE lets the request through as
 * "grace request N of M"; BLOCK (or GRACE with the grace requests used up) shows a danger alert
 * and disables the request fieldset, Submit included. The mode is server config, so both
 * variants are pinned here and neither is hardcoded in the page.
 *
 * Everything sits behind the `membership-support` flag; the flag-off case pins that the page
 * then sends the referee lookup exactly as before (no membership fields the server may not have).
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { test, expect, Page } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';
const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark

interface Scenario {
  flag: boolean;
  mode: 'GRACE' | 'BLOCK' | null;
  allowance: {
    tier: string;
    state: string;
    cap: number | null;
    used: number;
    remaining: number | null;
    periodEnd: string;
    graceUsed: number;
    graceRemaining: number;
  } | null;
}

const allowance = (state: string, used: number, graceUsed = 0, graceRemaining = 0) => ({
  tier: 'FREE',
  state,
  cap: 10,
  used,
  remaining: 10 - used,
  periodEnd: '2027-01-31',
  graceUsed,
  graceRemaining,
});

async function installMocks(page: Page, s: Scenario): Promise<string[]> {
  const contactLookups: string[] = [];
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
      return json({ data: { featureFlagsPublic: [{ key: 'membership-support', enabled: s.flag }] } });
    }
    if (raw.includes('boroughAvailabilityPublic')) {
      return json({ data: { boroughAvailabilityPublic: [] } });
    }
    // Before the generic adminConfig branch: the membership settings are read separately.
    if (raw.includes('findMembershipConfig')) {
      return json({ data: { adminConfig: { membershipOverLimitMode: s.mode, membershipGraceRequests: 2 } } });
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
      return json({ data: { referringOrganisationsPublic: [{ id: 'org-1', name: 'E2E Member Org' }] } });
    }
    if (raw.includes('findOrganisationContact')) {
      contactLookups.push(raw);
      const contact: any = { id: 'contact-1', fullName: 'E2E Contact' };
      if (raw.includes('membershipAllowance')) {
        contact.membershipAllowance = s.allowance;
      }
      return json({ data: { referringOrganisationContactsPublic: [contact] } });
    }
    return json({ data: {} });
  });
  return contactLookups;
}

async function advanceToRequestPage(page: Page): Promise<void> {
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
  const orgOption = page.locator('.ng-option', { hasText: 'E2E Member Org' });
  await expect(orgOption).toBeVisible({ timeout: 15_000 });
  await orgOption.click();

  await page.getByPlaceholder('Your email address').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Find Email' }).click();
  await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });
}

test.describe('membership public request form @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('last request: warning shown, request still submittable', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { flag: true, mode: 'BLOCK', allowance: allowance('LAST_REQUEST', 9) });
    await advanceToRequestPage(page);

    const notice = page.getByTestId('membership-notice-last');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText("This is your organisation's last request for this membership year");
    await expect(notice).toContainText('E2E Member Org has used 9 of its 10 free requests for 1 Feb 2026 to 31 Jan 2027');
    await expect(notice).toContainText('renews on 1 Feb 2027');
    await expect(page.getByTestId('request-fieldset')).not.toHaveAttribute('disabled');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('over the limit in GRACE mode: grace notice, request still submittable', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { flag: true, mode: 'GRACE', allowance: allowance('LIMIT_REACHED', 10, 0, 2) });
    await advanceToRequestPage(page);

    const notice = page.getByTestId('membership-notice-grace');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText('grace request 1 of 2');
    await expect(page.getByTestId('membership-notice-block')).toHaveCount(0);
    await expect(page.getByTestId('request-fieldset')).not.toHaveAttribute('disabled');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('over the limit in BLOCK mode: danger alert, fieldset and Submit disabled', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { flag: true, mode: 'BLOCK', allowance: allowance('LIMIT_REACHED', 10) });
    await advanceToRequestPage(page);

    const notice = page.getByTestId('membership-notice-block');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText('Your organisation has reached its request limit for this membership year');
    // toBeDisabled() only judges form controls, so check the fieldset's own attribute.
    await expect(page.getByTestId('request-fieldset')).toHaveAttribute('disabled', '');
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('GRACE mode with the grace requests used up behaves like BLOCK', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { flag: true, mode: 'GRACE', allowance: allowance('LIMIT_REACHED', 12, 2, 0) });
    await advanceToRequestPage(page);

    await expect(page.getByTestId('membership-notice-block')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('membership-notice-grace')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('flag off: no notice, and the referee lookup asks for no membership fields', async ({ page }) => {
    test.setTimeout(90_000);
    const lookups = await installMocks(page, { flag: false, mode: 'BLOCK', allowance: allowance('LIMIT_REACHED', 10) });
    await advanceToRequestPage(page);

    await expect(page.locator('membership-notice div')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups.every(q => !q.includes('membership'))).toBe(true);
  });
});
