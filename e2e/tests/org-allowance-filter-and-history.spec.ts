/**
 * Two follow-ups to membership support, for the organisation pages:
 *
 * - Organisation list: an "Allowance" filter for organisations near (80% or more used) or at
 *   their request limit. The server decides who is in each band (`membershipUsage` on
 *   ReferringOrganisationWhereInput); this pins what the dashboard sends.
 * - Organisation page: a History tab listing the audit trail with the membership tier and dates
 *   at each revision (`referringOrganisationAudits`), shown to admins only.
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const MEMBERSHIP = {
  tier: 'TIER_2', periodStart: '2026-11-01', periodEnd: '2027-10-31', cap: 40, used: 33, remaining: 7,
  state: 'OK', graceUsed: 0, expired: false, lapsedTier: null, lapsedOn: null,
};

const ORG = {
  id: 5,
  name: 'HISTORY-ORG',
  website: 'https://example.org',
  phoneNumber: '07700900000',
  requestCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  archived: false,
  membershipTier: 'TIER_2',
  membershipStartDate: '2026-11-01',
  membershipEndDate: '2027-10-31',
  membership: MEMBERSHIP,
  membershipContacts: [],
};

const snapshot = (over: Record<string, unknown>) => ({
  name: 'HISTORY-ORG', website: 'https://example.org', phoneNumber: '07700900000', archived: false,
  membershipTier: 'FREE', membershipStartDate: '2026-02-01', membershipEndDate: null, ...over,
});

/** Oldest first, as the server returns them. */
const AUDITS = [
  { // written before membership existed: no tier on the revision
    type: 'ADD', revision: { id: 11, timestamp: Date.parse('2026-01-01T09:00:00Z'), customUser: 'cat@example.org|Cat Admin' },
    entity: snapshot({ name: 'History Org', membershipTier: null, membershipStartDate: null }),
  },
  { // first revision with membership columns, and a rename
    type: 'MOD', revision: { id: 12, timestamp: Date.parse('2026-10-29T09:00:00Z'), customUser: 'cat@example.org|Cat Admin' },
    entity: snapshot({}),
  },
  {
    type: 'MOD', revision: { id: 13, timestamp: Date.parse('2026-10-30T09:00:00Z'), customUser: 'steve@example.org|Steve Staff' },
    entity: snapshot({ membershipTier: 'TIER_1', membershipStartDate: '2026-11-01', membershipEndDate: '2027-10-31' }),
  },
  {
    type: 'MOD', revision: { id: 14, timestamp: Date.parse('2026-11-02T10:00:00Z'), customUser: '|' },
    entity: snapshot({ membershipTier: 'TIER_2', membershipStartDate: '2026-11-01', membershipEndDate: '2027-10-31' }),
  },
];

/** Stubs every query these pages make; records the variables sent with each operation. */
async function installMocks(page: Page, flag = true): Promise<Record<string, any[]>> {
  const seen: Record<string, any[]> = {};
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const record = (op: string) => (seen[op] = [...(seen[op] ?? []), JSON.parse(raw).variables]);
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (raw.includes('buildInfo')) {
      return json({ buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({ featureFlagsPublic: [{ key: 'membership-support', enabled: flag }] });
    }
    if (raw.includes('findAllReferringOrgs')) {
      record('orgs');
      return json({ referringOrganisationsConnection: { totalElements: 1, content: [ORG] } });
    }
    if (raw.includes('getReferringOrganisationAuditTrail')) {
      record('audits');
      return json({ referringOrganisationAudits: AUDITS });
    }
    if (raw.includes('findReferringOrganisation(')) {
      return json({ referringOrganisation: ORG });
    }
    if (raw.includes('findAllReferringOrgContacts')) {
      return json({ referringOrganisationContactsConnection: { totalElements: 0, content: [] } });
    }
    if (raw.includes('findAllDeviceRequests') || raw.includes('findAllOrgs')) {
      return json({ deviceRequestConnection: { totalElements: 0, content: [] } });
    }
    return json({});
  });
  return seen;
}

const lastFilter = (seen: Record<string, any[]>) => seen.orgs?.[seen.orgs.length - 1]?.filter;

test.describe('organisation allowance filter and history @mocked', () => {
  test('list: the Allowance filter sends the chosen bands to the server', async ({ page }) => {
    test.setTimeout(60_000);
    const seen = await installMocks(page);
    await page.goto('/dashboard/referring-organisations');
    await expect(page.locator('#referring-org-index tbody tr', { hasText: 'HISTORY-ORG' })).toBeVisible({ timeout: 30_000 });
    expect(lastFilter(seen).membershipUsage).toBeUndefined();

    await page.getByText('Filter', { exact: false }).first().click();
    const modal = page.locator('.modal-content');
    await expect(modal.getByText('Filter by Allowance')).toBeVisible();
    await modal.getByLabel('Near limit (80% or more used)').check();
    await modal.getByLabel('Limit reached').check();
    await modal.getByRole('button', { name: 'Filter' }).click();

    await expect.poll(() => lastFilter(seen)?.membershipUsage).toEqual({ _in: ['NEAR_LIMIT', 'LIMIT_REACHED'] });
    // Still combined with the default active-organisations filter, and counted on the button.
    expect(lastFilter(seen).archived).toEqual({ _in: [false] });
    await expect(page.locator('.btn-info .badge')).toHaveText('3');
  });

  test('list: with the membership flag off a saved Allowance filter is not sent', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem(
      'referringOrgFilters-referring-org-index',
      JSON.stringify({ archived: [false], membershipUsage: ['LIMIT_REACHED'] }),
    ));
    const seen = await installMocks(page, false);
    await page.goto('/dashboard/referring-organisations');
    await expect(page.locator('#referring-org-index tbody tr', { hasText: 'HISTORY-ORG' })).toBeVisible({ timeout: 30_000 });

    expect(seen.orgs.length).toBeGreaterThan(0);
    expect(seen.orgs.every(v => v.filter.membershipUsage === undefined)).toBe(true);
  });

  test('detail: admins get a History tab showing how the membership changed', async ({ page }) => {
    test.setTimeout(60_000);
    await loginWith(page, ['read:organisations', 'write:organisations', 'admin:organisations']);
    const seen = await installMocks(page);
    await page.goto('/dashboard/referring-organisations/5');

    await page.getByTestId('org-history-tab').click({ timeout: 30_000 });
    const rows = page.getByTestId('org-history-row');
    await expect(rows).toHaveCount(4);
    expect(seen.audits[0]).toEqual({ id: 5 });

    // Newest first.
    await expect(rows.nth(0)).toContainText('System');
    await expect(rows.nth(0).getByTestId('org-history-changes')).toHaveText('Tier: Tier 1 → Tier 2');
    await expect(rows.nth(0)).toHaveClass(/table-warning/);

    await expect(rows.nth(1)).toContainText('Steve Staff');
    await expect(rows.nth(1).getByTestId('org-history-changes')).toContainText('Tier: Free → Tier 1');
    await expect(rows.nth(1).getByTestId('org-history-changes')).toContainText('Membership start: 1 Feb 2026 → 1 Nov 2026');
    await expect(rows.nth(1).getByTestId('org-history-changes')).toContainText('Membership end: none → 31 Oct 2027');
    await expect(rows.nth(1)).toContainText('31 Oct 2027');

    // The revision before membership existed has no tier: the next one reports the rename only.
    await expect(rows.nth(2).getByTestId('org-history-changes')).toHaveText('Name: History Org → HISTORY-ORG');
    await expect(rows.nth(2)).not.toHaveClass(/table-warning/);

    await expect(rows.nth(3)).toContainText('Cat Admin');
    await expect(rows.nth(3).getByTestId('org-history-changes')).toHaveText('Organisation created');
  });

  test('detail: no History tab, and no audit query, without an admin permission', async ({ page }) => {
    test.setTimeout(60_000);
    await loginWith(page, ['read:organisations', 'write:organisations', 'read:requests']);
    const seen = await installMocks(page);
    await page.goto('/dashboard/referring-organisations/5');

    await expect(page.getByRole('tab', { name: 'Referees' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('org-history-tab')).toHaveCount(0);
    expect(seen.audits).toBeUndefined();
  });
});
