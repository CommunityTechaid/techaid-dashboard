/**
 * techaid-server#345 — views that still needed `read:organisations` after the #288 permission split.
 *
 * The mocks answer like the server does: the full-record organisation queries are DENIED (GraphQL
 * errors) unless the token holds read:organisations, so a view still using them goes red.
 *   - referee page org picker: a `write:referees` token must be able to search organisations.
 *   - staff request form: a `write:requests` token must get the membership allowance hint.
 *
 * @mocked — all GraphQL stubbed; fake JWTs carry the permission sets.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';
const COVERED_POSTCODE = 'SE15 5TD';

const MEMBERSHIP = {
  tier: 'FREE', periodStart: '2026-02-01', periodEnd: '2027-01-31', cap: 10, used: 3, remaining: 7,
  state: 'OK', graceUsed: 0, expired: false, lapsedTier: null, lapsedOn: null,
};

/** Server-shaped denial for the legacy read:organisations-only fields. */
const DENIED = { errors: [{ message: 'Access Denied', extensions: { classification: 'FORBIDDEN' } }], data: null };

async function installMocks(page: Page, log: string[]): Promise<void> {
  await page.route('**://techaid-auth.eu.auth0.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }));
  await page.route('**://communitytechaid.github.io/**', r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }));

  // Every token in this file lacks read:organisations, so the legacy full-record queries are denied.
  await page.route('**/graphql', async (route: Route) => {
    const raw = route.request().postData() ?? '';
    log.push(raw);
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const data = (d: unknown) => json({ data: d });

    if (raw.includes('buildInfo')) return data({ buildInfo: { version: 'e2e', commit: 'e2e', time: TS } });
    if (raw.includes('featureFlagsPublic')) {
      return data({ featureFlagsPublic: [{ key: 'membership-support', enabled: true }] });
    }
    if (raw.includes('boroughAvailabilityPublic')) return data({ boroughAvailabilityPublic: [] });
    if (raw.includes('findMembershipConfig')) {
      return data({ adminConfig: { membershipOverLimitMode: 'GRACE', membershipGraceRequests: 2 } });
    }
    if (raw.includes('adminConfig')) {
      return data({
        adminConfig: {
          canPublicRequestSIMCard: true, canPublicRequestLaptop: true, canPublicRequestPhone: true,
          canPublicRequestBroadbandHub: true, canPublicRequestTablet: true, canPublicRequestDesktop: true,
        },
      });
    }
    if (raw.includes('findContent')) return data({ post: { id: '1', content: '<p>E2E request page content</p>' } });

    // The narrow lookups.
    if (raw.includes('referringOrganisationsPublic')) {
      return data({ referringOrganisationsPublic: [{ id: '914', name: 'E2E Searchable Org' }] });
    }
    if (raw.includes('referringOrganisationMembershipHint')) {
      return data({
        referringOrganisationMembershipHint: {
          id: '913', name: 'E2E Picker Org', membership: MEMBERSHIP,
          membershipContacts: [{ id: '912', fullName: 'E2E Contact' }],
        },
      });
    }
    // The legacy full-record queries need read:organisations.
    if (raw.includes('referringOrganisationsConnection') || /referringOrganisation\(where/.test(raw)) {
      return json(DENIED);
    }

    if (raw.includes('findReferringOrganisationContact')) {
      return data({
        referringOrganisationContact: {
          id: 912, fullName: 'E2E Referee', email: 'a@example.org', phoneNumber: '07700900000', address: '',
          createdAt: TS, updatedAt: TS, archived: false, notes: [], isMembershipContact: false,
          referringOrganisation: { id: 913, name: 'E2E Picker Org' },
        },
      });
    }
    if (raw.includes('findOrganisationContact')) {
      return data({ referringOrganisationContactsPublic: [{ id: '912', fullName: 'E2E Contact', isMembershipContact: true }] });
    }
    return data({});
  });
}

test.describe('read:organisations gaps (#345) @mocked', () => {
  test('referee page: write:referees without read:organisations can search organisations', async ({ page }) => {
    test.setTimeout(90_000);
    const log: string[] = [];
    await installMocks(page, log);
    await loginWith(page, ['read:referees', 'write:referees'], {});
    await page.goto('/dashboard/referring-organisation-contacts/912');

    const select = page.locator('formly-form ng-select').first();
    await expect(select).toBeVisible({ timeout: 30_000 });
    await select.locator('input').fill('E2E');
    await expect(page.locator('.ng-option', { hasText: 'E2E Searchable Org' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Failed to load referring organisations')).toHaveCount(0);
    expect(log.filter(q => q.includes('referringOrganisationsConnection'))).toHaveLength(0);
  });

  test('staff request form: write:requests without read:organisations gets the allowance hint', async ({ page }) => {
    test.setTimeout(90_000);
    const log: string[] = [];
    await installMocks(page, log);
    await loginWith(page, ['read:requests', 'write:requests'], {});
    await page.goto('/device-request-admin');
    await expect(page.locator('#postcode')).toBeVisible({ timeout: 30_000 });

    await page.locator('#postcode').fill(COVERED_POSTCODE);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Submit a request' }).click();

    const orgSelectInput = page.locator('form-choice ng-select input');
    await expect(orgSelectInput).toBeVisible({ timeout: 15_000 });
    await orgSelectInput.fill('E2E');
    await page.locator('.ng-option', { hasText: 'E2E Searchable Org' }).click();
    await page.getByPlaceholder('Your email address').fill('e2e@example.com');
    await page.getByRole('button', { name: 'Find Email' }).click();

    const hint = page.getByTestId('admin-membership-badges');
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('E2E Picker Org');
    expect(log.some(q => q.includes('referringOrganisationMembershipHint'))).toBe(true);
    expect(log.some(q => /referringOrganisation\(where/.test(q))).toBe(false);
  });
});
