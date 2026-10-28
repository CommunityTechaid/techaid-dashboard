/**
 * Membership tab of the Admin Panel (techaid-server#311/#313): over-limit mode + grace count.
 *
 * @mocked — all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';

async function installMocks(page: Page, opts: { queryError?: boolean; saves?: any[] } = {}) {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('featureFlagsPublic')) return json({ data: { featureFlagsPublic: [] } });
    if (raw.includes('updateAdminConfig')) {
      const data = JSON.parse(raw).variables?.data;
      opts.saves?.push(data);
      return json({ data: { updateAdminConfig: { id: '1', ...data, updatedAt: '2026-01-02T00:00:00Z' } } });
    }
    if (raw.includes('membershipOverLimitMode')) {
      if (opts.queryError) {
        return json({ errors: [{ message: "Field 'membershipOverLimitMode' in type 'AdminConfig' is undefined" }] });
      }
      return json({
        data: {
          adminConfig: { id: '1', membershipOverLimitMode: 'BLOCK', membershipGraceRequests: 2, updatedAt: null },
        },
      });
    }
    if (raw.includes('featureFlags')) return json({ data: { featureFlags: [] } });
    return json({ data: {} });
  });
}

async function openTab(page: Page) {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'Membership' }).click();
}

test.describe('membership settings @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ['app:admin']);
  });

  test('loads with BLOCK and grace 2, grace input disabled', async ({ page }) => {
    await installMocks(page);
    await openTab(page);
    await expect(page.getByLabel(/Hard block/)).toBeChecked({ timeout: 15_000 });
    await expect(page.getByTestId('membership-grace-requests')).toBeDisabled();
    await expect(page.getByTestId('membership-grace-requests')).toHaveValue('2');
  });

  test('saves only the two membership fields', async ({ page }) => {
    const saves: any[] = [];
    await installMocks(page, { saves });
    await openTab(page);
    await expect(page.getByTestId('membership-settings-save')).toBeDisabled({ timeout: 15_000 });
    await page.getByLabel(/Grace period/).check();
    await page.getByTestId('membership-grace-requests').fill('3');
    await page.getByTestId('membership-settings-save').click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ membershipOverLimitMode: 'GRACE', membershipGraceRequests: 3 });
    expect(Object.keys(saves[0]).some(k => k.startsWith('canPublicRequest'))).toBe(false);
    await expect(page.getByTestId('membership-settings-save')).toBeDisabled();
  });

  test('shows the info message when the query errors', async ({ page }) => {
    await installMocks(page, { queryError: true });
    await openTab(page);
    await expect(page.getByText('Membership settings will be available once the server update')).toBeVisible({
      timeout: 15_000,
    });
  });
});
