/**
 * A donor with no parent donor (`donorParent: null`) must open cleanly.
 *
 * donor-info's load callback read `this.model['donorParent']['id']` unguarded, so for any donor
 * without a parent it threw `TypeError: Cannot read properties of null (reading 'id')` straight after
 * setting the model: the error was uncaught and the page never set `entityName`, leaving the
 * breadcrumb and card header blank. Found by the live `uat-list-pages-live` "donor devices" check
 * on UAT donor 1671.
 *
 * @mocked — GraphQL stubbed; runs in CI's e2e-mocked gate.
 */
import { test, expect } from '../helpers/csp';

test.describe('donor-info with no parent donor @mocked', () => {
  test('opens without a page error and shows the donor name', async ({ page }) => {
    test.setTimeout(60_000);

    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      const data = body.includes('buildInfo')
        ? { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } }
        : body.includes('findDonor')
          ? {
              donor: {
                id: 1671,
                name: 'NO-PARENT DONOR',
                postCode: 'SW9 0AA',
                phoneNumber: '07700900000',
                email: 'no-parent@example.org',
                referral: null,
                archived: false,
                isLeadContact: false,
                donorParent: null,
                kits: [],
              },
            }
          : {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    });

    await page.goto('/dashboard/donors/1671');

    await expect(page.locator('.breadcrumb-item.active')).toHaveText('NO-PARENT DONOR', { timeout: 30_000 });
    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
