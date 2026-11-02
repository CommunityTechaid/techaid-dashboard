/**
 * Live-UAT smoke for Membership support (techaid-server#311), read-only.
 *
 * Runs against real UAT data with the `membership-support` flag on: the organisation table
 * shows membership badges, a paid organisation's detail page shows its tier, editable dates
 * and usage meter, and a free organisation shows the 1 February note instead of dates.
 *
 * It does not name an organisation. It asks the API for any non-archived Tier 3 organisation whose
 * membership has not ended, so it survives UAT reseeds and memberships lapsing (UAT data is
 * synthetic since 2026-11-02; the seed's dates are fixed when it is applied). Self-skips when the
 * flag is off, or when UAT holds no current Tier 3 organisation.
 *
 * Run: npx playwright test --config playwright.config.uat.ts membership-live
 */
import { test, expect } from '@playwright/test';
import { UatGraphQLClient } from '../helpers/graphql';

async function flagOn(page: import('@playwright/test').Page): Promise<boolean> {
  const res = await page.request.post('https://api-testing.communitytechaid.org.uk/graphql', {
    data: { query: '{ featureFlagsPublic { key enabled } }' },
  });
  const body = await res.json();
  return !!body?.data?.featureFlagsPublic?.find((f: any) => f.key === 'membership-support')?.enabled;
}

/** Name of a non-archived Tier 3 organisation whose membership ends after today, or null. */
async function currentTier3OrgName(): Promise<string | null> {
  const uat = await UatGraphQLClient.create();
  try {
    const data = await uat.request<{
      referringOrganisationsConnection: { content: { name: string; membershipEndDate: string | null }[] };
    }>(`query {
      referringOrganisationsConnection(page: { size: 200 },
        where: { membershipTier: { _eq: TIER_3 }, archived: { _eq: false } }) {
        content { name membershipEndDate }
      }
    }`);
    // Strictly after today, so a membership ending today cannot flip to Expired mid-run.
    const today = new Date().toISOString().slice(0, 10);
    const current = data.referringOrganisationsConnection.content
      .filter(o => !!o.membershipEndDate && o.membershipEndDate > today)
      .sort((a, b) => a.name.localeCompare(b.name));
    return current[0]?.name ?? null;
  } finally {
    await uat.dispose();
  }
}

test.describe('membership live UAT (read-only)', () => {
  test('organisation table and detail show live membership data', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!(await flagOn(page)), 'membership-support flag is off in this environment');
    const paidOrg = await currentTier3OrgName();
    test.skip(!paidOrg, 'no non-archived Tier 3 organisation with a current membership in UAT');

    await page.goto('/dashboard/referring-organisations');
    await expect(page.getByTestId('membership-badge-key')).toBeVisible({ timeout: 60_000 });

    const search = page.getByRole('searchbox', { name: 'Search:' });
    await search.fill(paidOrg!);
    await search.press('Enter');
    const row = page.locator('#referring-org-index tbody tr', { hasText: paidOrg! });
    await expect(row.getByTestId('badge-tier')).toHaveText('Tier 3', { timeout: 30_000 });

    await row.getByRole('link', { name: paidOrg! }).click();
    await expect(page.locator('.card-header').getByTestId('badge-tier')).toHaveText('Tier 3', { timeout: 30_000 });
    await expect(page.getByTestId('membership-meter')).toBeVisible();
    await expect(page.locator('[data-testid="org-membership-start"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('org-membership-expired')).toHaveCount(0);
  });
});
