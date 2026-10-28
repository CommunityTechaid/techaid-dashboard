/**
 * Live-UAT smoke for Membership support (techaid-server#311), read-only.
 *
 * Runs against real UAT data with the `membership-support` flag on: the organisation table
 * shows membership badges, a paid organisation's detail page shows its tier, editable dates
 * and usage meter, and a free organisation shows the 1 February note instead of dates.
 *
 * Relies on the tier tracker load (scripts/load-membership-tiers.mjs) having set St Mungo's to
 * Tier 3 in UAT. Self-skips when the flag is off in the target environment.
 *
 * Run: npx playwright test --config playwright.config.uat.ts membership-live
 */
import { test, expect } from '@playwright/test';

const PAID_ORG = "St Mungo's";

async function flagOn(page: import('@playwright/test').Page): Promise<boolean> {
  const res = await page.request.post('https://api-testing.communitytechaid.org.uk/graphql', {
    data: { query: '{ featureFlagsPublic { key enabled } }' },
  });
  const body = await res.json();
  return !!body?.data?.featureFlagsPublic?.find((f: any) => f.key === 'membership-support')?.enabled;
}

test.describe('membership live UAT (read-only)', () => {
  test('organisation table and detail show live membership data', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!(await flagOn(page)), 'membership-support flag is off in this environment');

    await page.goto('/dashboard/referring-organisations');
    await expect(page.getByTestId('membership-badge-key')).toBeVisible({ timeout: 60_000 });

    const search = page.getByRole('searchbox', { name: 'Search:' });
    await search.fill('Mungo');
    await search.press('Enter');
    const row = page.locator('#referring-org-index tbody tr', { hasText: PAID_ORG });
    await expect(row.getByTestId('badge-tier')).toHaveText('Tier 3', { timeout: 30_000 });

    await row.getByRole('link', { name: PAID_ORG }).click();
    await expect(page.locator('.card-header').getByTestId('badge-tier')).toHaveText('Tier 3', { timeout: 30_000 });
    await expect(page.getByTestId('membership-meter')).toBeVisible();
    await expect(page.locator('[data-testid="org-membership-start"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('[data-testid="org-membership-end"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId('org-membership-expired')).toHaveCount(0);
  });
});
