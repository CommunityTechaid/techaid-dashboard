/**
 * Membership badge vocabulary on the staff tables and the organisation detail page
 * (techaid-server#311): Free and paid tier badges, Last request, Limit reached, Membership
 * contact and Grace N of M.
 *
 * All of it sits behind the `membership-support` flag so the dashboard can ship before the
 * server: the flag-off test pins that the tables then send no membership fields at all.
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { test, expect, Page } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const membership = (tier: string, state: string, used: number, cap: number | null) => ({
  tier,
  periodStart: '2026-02-01',
  periodEnd: '2027-01-31',
  cap,
  used,
  remaining: cap == null ? null : cap - used,
  state,
  graceUsed: 0,
  expired: false,
  lapsedTier: null,
  lapsedOn: null,
});

const FREE_OK = membership('FREE', 'OK', 3, 10);
const TIER1_LAST = membership('TIER_1', 'LAST_REQUEST', 19, 20);
const FREE_LIMIT = membership('FREE', 'LIMIT_REACHED', 10, 10);

const EXPIRED = {
  ...membership('FREE', 'OK', 3, 10),
  expired: true,
  lapsedTier: 'TIER_2',
  lapsedOn: '2026-09-30',
};

/** Stored (staff-set) tier and dates; `membership` is the server's effective view. */
const STORED: Record<number, any> = {
  1: { membershipTier: 'FREE' },
  2: { membershipTier: 'TIER_1', membershipStartDate: '2026-02-01', membershipEndDate: '2027-01-31' },
  3: { membershipTier: 'FREE' },
  4: { membershipTier: 'TIER_2', membershipStartDate: '2025-10-01', membershipEndDate: '2026-09-30' },
};

const org = (id: number, name: string, m: any) => ({
  id,
  name,
  website: 'https://example.org',
  phoneNumber: '07700900000',
  requestCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archived: false,
  membershipTier: m.tier,
  ...STORED[id],
  membership: m,
});

/** Stubs every query these pages make; records the request bodies per operation. */
async function installMocks(page: Page, flag: boolean): Promise<Record<string, string[]>> {
  const seen: Record<string, string[]> = {};
  const record = (op: string, body: string) => (seen[op] = [...(seen[op] ?? []), body]);

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (raw.includes('buildInfo')) {
      return json({ buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({ featureFlagsPublic: [{ key: 'membership-support', enabled: flag }] });
    }
    if (raw.includes('findMembershipGraceRequests')) {
      return json({ adminConfig: { membershipGraceRequests: 2 } });
    }
    if (raw.includes('findAllReferringOrgs')) {
      record('orgs', raw);
      return json({
        referringOrganisationsConnection: {
          totalElements: 4,
          content: [
            org(1, 'MEMBER-FREE-ORG', FREE_OK),
            org(2, 'MEMBER-LAST-ORG', TIER1_LAST),
            org(3, 'MEMBER-LIMIT-ORG', FREE_LIMIT),
            org(4, 'MEMBER-EXPIRED-ORG', EXPIRED),
          ],
        },
      });
    }
    if (raw.includes('findReferringOrganisation(')) {
      record('org', raw);
      const id = +(/"id":\s*"?(\d+)/.exec(raw)?.[1] ?? 2);
      const byId: Record<number, [string, any]> = {
        1: ['MEMBER-FREE-ORG', FREE_OK], 2: ['MEMBER-LAST-ORG', TIER1_LAST], 4: ['MEMBER-EXPIRED-ORG', EXPIRED],
      };
      return json({
        referringOrganisation: {
          ...org(id, ...byId[id]),
          membershipContacts: [{ id: 7, fullName: 'Bola Adeniji' }],
        },
      });
    }
    if (raw.includes('findAllReferringOrgContacts')) {
      record('referees', raw);
      return json({
        referringOrganisationContactsConnection: {
          totalElements: 1,
          content: [{
            id: 7,
            fullName: 'Bola Adeniji',
            email: 'bola@example.org',
            phoneNumber: '07700900001',
            requestCount: 1,
            isMembershipContact: true,
            referringOrganisation: { id: 3, name: 'MEMBER-LIMIT-ORG', membershipTier: 'FREE', membership: FREE_LIMIT },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            archived: false,
          }],
        },
      });
    }
    // The embedded request table on the organisation/referee pages runs as findAllOrgs.
    if (raw.includes('findAllDeviceRequests') || raw.includes('findAllOrgs')) {
      record('requests', raw);
      return json({
        deviceRequestConnection: {
          totalElements: 1,
          content: [{
            id: 7314,
            status: 'NEW',
            clientRef: 'GR-1',
            borough: 'Lambeth',
            deviceRequestItems: {
              phones: 0, tablets: 0, laptops: 1, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0,
            },
            kits: [],
            referringOrganisationContact: {
              id: 7,
              fullName: 'Bola Adeniji',
              referringOrganisation: { id: 3, name: 'MEMBER-LIMIT-ORG', membership: FREE_LIMIT },
            },
            isPrepped: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            membershipGraceIndex: 1,
          }],
        },
      });
    }
    return json({});
  });
  return seen;
}

test.describe('membership badges @mocked', () => {
  test('organisation table: Free, paid tier, Last request, Limit reached and usage', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations');

    const row = (name: string) => page.locator('#referring-org-index tbody tr', { hasText: name });
    await expect(row('MEMBER-FREE-ORG')).toBeVisible({ timeout: 30_000 });

    await expect(row('MEMBER-FREE-ORG').getByTestId('badge-tier')).toHaveText('Free');
    await expect(row('MEMBER-FREE-ORG').getByTestId('badge-tier')).toHaveClass(/badge-tier-free/);
    await expect(row('MEMBER-FREE-ORG').getByTestId('badge-last')).toHaveCount(0);
    await expect(row('MEMBER-FREE-ORG').getByTestId('badge-limit')).toHaveCount(0);

    await expect(row('MEMBER-LAST-ORG').getByTestId('badge-tier')).toHaveText('Tier 1');
    await expect(row('MEMBER-LAST-ORG').getByTestId('badge-tier')).toHaveClass(/badge-tier-paid/);
    await expect(row('MEMBER-LAST-ORG').getByTestId('badge-last')).toHaveText('Last request');

    await expect(row('MEMBER-LIMIT-ORG').getByTestId('badge-limit')).toHaveText('Limit reached');
    await expect(row('MEMBER-LIMIT-ORG').getByTestId('membership-usage')).toHaveText('10 / 10');

    await expect(page.getByTestId('membership-badge-key')).toBeVisible();
  });

  test('organisation detail: tier badge, Membership section, meter and contacts', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations/2');

    await expect(page.locator('.card-header').getByTestId('badge-tier')).toHaveText('Tier 1', { timeout: 30_000 });
    await expect(page.getByTestId('membership-meter-used')).toHaveText('19 of 20 used');
    await expect(page.getByTestId('membership-meter').locator('.cta-meter-fill')).toHaveClass(/warn/);
    await expect(page.getByTestId('org-membership-contacts')).toContainText('Bola Adeniji');
    await expect(page.locator('[data-testid="org-membership-start"]')).toHaveValue('2026-02-01');
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue('2027-01-31');
    await expect(page.getByTestId('org-membership-expired')).toHaveCount(0);
  });

  test('expired paid membership: Expired badge on the table and a warning on the detail page', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations');
    const row = page.locator('#referring-org-index tbody tr', { hasText: 'MEMBER-EXPIRED-ORG' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId('badge-tier')).toHaveText('Free');
    await expect(row.getByTestId('badge-expired')).toHaveText('Expired');

    await page.goto('/dashboard/referring-organisations/4');
    await expect(page.getByTestId('org-membership-expired')).toContainText('Tier 2 membership ended on 30 Sep 2026', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue('2026-09-30');
  });

  test('organisation detail: changing the start date re-defaults the end date', async ({ page }) => {
    test.setTimeout(60_000);
    // The form is read-only without write:organisations, and CI's fake token carries no
    // permissions (passes locally against a real token, times out in CI without this).
    await authenticateWithPermissions(page, ['read:organisations', 'write:organisations']);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations/2');
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue('2027-01-31', { timeout: 30_000 });
    await page.locator('[data-testid="org-membership-start"]').fill('2026-06-15');
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue('2027-06-14');
    await expect(page.locator('[data-testid="org-membership-end"]')).toBeEnabled();
  });

  test('organisation detail: a free organisation hides the dates and shows the 1 February note', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations/1');
    await expect(page.getByText('Free tier: uses the standard membership year')).toContainText('1 February to 31 January', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="org-membership-start"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveCount(0);
  });

  test('referee table: Membership contact badge and the organisation state', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisation-contacts');

    const row = page.locator('#referring-org-contact-index tbody tr', { hasText: 'Bola Adeniji' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId('badge-contact')).toHaveText('Membership contact');
    await expect(row.getByTestId('badge-limit')).toHaveText('Limit reached');
  });

  test('request table: Grace N of M on an over-limit request', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    // A true unfiltered view (the component otherwise defaults to {is_sales:[false]}).
    await page.addInitScript(() => localStorage.setItem('deviceRequestFilters-device-request-index', '{}'));
    await page.goto('/dashboard/device-requests');

    const row = page.locator('#device-request-index tbody tr', { hasText: 'Bola Adeniji' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId('badge-grace')).toHaveText('Grace 1 of 2');
    await expect(row.getByTestId('badge-limit')).toHaveText('Limit reached');
  });

  test('organisation detail tabs: embedded referee and request tables carry the badges', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, true);
    await page.goto('/dashboard/referring-organisations/2');
    await expect(page.getByTestId('membership-meter')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: 'Referees' }).click();
    const referee = page.locator('tbody tr', { hasText: 'Bola Adeniji' });
    await expect(referee.getByTestId('badge-contact')).toHaveText('Membership contact', { timeout: 15_000 });

    await page.getByRole('tab', { name: 'Device Requests' }).click();
    await expect(page.getByTestId('badge-grace').first()).toHaveText('Grace 1 of 2', { timeout: 15_000 });
  });

  test('flag off: no badges, and the tables request no membership fields', async ({ page }) => {
    test.setTimeout(60_000);
    const seen = await installMocks(page, false);
    await page.goto('/dashboard/referring-organisations');

    await expect(page.locator('#referring-org-index tbody tr', { hasText: 'MEMBER-FREE-ORG' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('membership-badges')).toHaveCount(0);
    await expect(page.getByTestId('membership-badge-key')).toHaveCount(0);
    expect(seen.orgs?.length).toBeGreaterThan(0);
    expect(seen.orgs.every(q => !q.includes('membership'))).toBe(true);
  });
});
