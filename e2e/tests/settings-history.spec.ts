/**
 * Admin Panel History tab (issue #273): who changed which setting, when, and from what.
 *
 * Built against the `settingChanges` contract of techaid-server#327. The rows are stubbed so
 * every display rule is pinned: a user flag flip, a borough cell change, a membership
 * GRACE -> BLOCK change by a user with no name, a MIGRATION row with no user, a deleted group.
 *
 * @mocked — all GraphQL stubbed, Auth0 cache written directly; runs under the production CSP.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';

const user = (name: string | null, email: string) => ({
  source: 'USER',
  changedByName: name,
  changedByEmail: email,
});
const base = { subjectId: null, subjectLabel: null };

const ROWS = [
  {
    ...base,
    id: '5',
    changedAt: '2026-11-02T14:03:00Z',
    ...user('Jo Smith', 'jo@example.org'),
    settingType: 'FEATURE_FLAG',
    settingKey: 'delivery-booking',
    field: 'enabled',
    changeType: 'UPDATED',
    oldValue: 'false',
    newValue: 'true',
  },
  {
    id: '4',
    changedAt: '2026-11-02T13:40:00Z',
    ...user('Jo Smith', 'jo@example.org'),
    settingType: 'BOROUGH_AVAILABILITY',
    settingKey: '3:laptops',
    subjectId: '3',
    subjectLabel: 'Lambeth and Southwark',
    field: 'mode',
    changeType: 'UPDATED',
    oldValue: 'OFF',
    newValue: 'ON',
  },
  {
    ...base,
    id: '3',
    changedAt: '2026-11-01T09:00:00Z',
    ...user('', 'sam@example.org'),
    settingType: 'ADMIN_CONFIG',
    settingKey: 'membershipOverLimitMode',
    field: 'membershipOverLimitMode',
    changeType: 'UPDATED',
    oldValue: 'GRACE',
    newValue: 'BLOCK',
  },
  {
    ...base,
    id: '2',
    changedAt: '2026-10-28T10:00:00Z',
    source: 'MIGRATION',
    changedByName: null,
    changedByEmail: null,
    settingType: 'FEATURE_FLAG',
    settingKey: 'membership-support',
    field: 'enabled',
    changeType: 'CREATED',
    oldValue: null,
    newValue: 'false',
  },
  {
    id: '1',
    changedAt: '2026-10-20T10:00:00Z',
    ...user('Jo Smith', 'jo@example.org'),
    settingType: 'BOROUGH_GROUP',
    settingKey: '7',
    subjectId: '7',
    subjectLabel: 'Tower Hamlets',
    field: 'name',
    changeType: 'DELETED',
    oldValue: 'Tower Hamlets',
    newValue: null,
  },
];

interface MockOpts {
  rows?: unknown[];
  totalPages?: number;
  error?: boolean;
  /** Variables of every settingChanges request, in order. */
  requests?: any[];
}

async function installMocks(page: Page, opts: MockOpts = {}) {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('settingChanges')) {
      const variables = JSON.parse(raw).variables ?? {};
      opts.requests?.push(variables);
      if (opts.error) return json({ errors: [{ message: 'Access Denied' }] });
      const content = opts.rows ?? ROWS;
      return json({
        data: {
          settingChanges: {
            totalElements: content.length,
            totalPages: opts.totalPages ?? 1,
            number: variables.page ?? 0,
            size: variables.size ?? 20,
            content,
          },
        },
      });
    }
    if (raw.includes('featureFlagsPublic')) return json({ data: { featureFlagsPublic: [] } });
    if (raw.includes('featureFlags')) return json({ data: { featureFlags: [] } });
    return json({ data: {} });
  });
}

async function openHistory(page: Page) {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'History', exact: true }).click({ timeout: 15_000 });
}

const rows = (page: Page) => page.getByTestId('settings-history-row');

test.describe('settings history tab @mocked', () => {
  test('tab is absent without app:admin', async ({ page }) => {
    await authenticateWithPermissions(page, []);
    await installMocks(page);
    await page.goto(ADMIN_PANEL_PATH);
    await expect(page.getByRole('link', { name: 'Feature Flags' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'History', exact: true })).toHaveCount(0);
  });

  test.describe('as an admin', () => {
    test.beforeEach(async ({ page }) => {
      await authenticateWithPermissions(page, ['app:admin']);
    });

    test('rows read as sentences, automated changes show System', async ({ page }) => {
      const requests: any[] = [];
      await installMocks(page, { requests });
      await openHistory(page);
      await expect(rows(page)).toHaveCount(5, { timeout: 15_000 });
      expect(requests[0]).toMatchObject({ page: 0, size: 20 });
      expect(requests[0].settingType ?? null).toBeNull();
      expect(requests[0].settingKey ?? null).toBeNull();

      const flag = rows(page).nth(0);
      await expect(flag.getByTestId('history-who')).toHaveText('Jo Smith');
      await expect(flag.getByTestId('history-who')).toHaveAttribute('title', 'jo@example.org');
      await expect(flag.getByTestId('history-setting')).toHaveText('Feature flag delivery-booking');
      await expect(flag.getByTestId('history-change')).toHaveText('enabled: Off → On');
      await expect(flag.getByTestId('history-when')).toContainText('2 Nov 2026');

      const cell = rows(page).nth(1);
      await expect(cell.getByTestId('history-setting')).toHaveText('Borough group "Lambeth and Southwark" / Laptops');
      await expect(cell.getByTestId('history-change')).toHaveText('mode: OFF → ON');

      const membership = rows(page).nth(2);
      // A user with a blank name still never renders a blank Who.
      await expect(membership.getByTestId('history-who')).toHaveText('sam@example.org');
      await expect(membership.getByTestId('history-setting')).toHaveText('Membership settings');
      await expect(membership.getByTestId('history-change')).toHaveText('over-limit mode: Grace period → Hard block');

      const migration = rows(page).nth(3);
      await expect(migration.getByTestId('history-who')).toHaveText('System');
      await expect(migration.getByTestId('history-change')).toHaveText('enabled: (created) → Off');

      const deleted = rows(page).nth(4);
      await expect(deleted.getByTestId('history-setting')).toHaveText('Borough group "Tower Hamlets"');
      await expect(deleted.getByTestId('history-change')).toHaveText('name: Tower Hamlets → (deleted)');
    });

    test('type and key filters send the expected variables', async ({ page }) => {
      const requests: any[] = [];
      await installMocks(page, { requests });
      await openHistory(page);
      await expect(rows(page)).toHaveCount(5, { timeout: 15_000 });

      await page.getByTestId('history-type').selectOption({ label: 'Feature flags' });
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1]).toMatchObject({ settingType: 'FEATURE_FLAG', page: 0 });

      await page.getByTestId('history-type').selectOption({ label: 'Device availability' });
      await expect.poll(() => requests.length).toBe(3);
      expect(requests[2]).toMatchObject({ settingType: 'BOROUGH_AVAILABILITY' });

      await page.getByTestId('history-key').fill('3:laptops');
      await page.getByTestId('history-key').press('Enter');
      await expect.poll(() => requests.length).toBe(4);
      expect(requests[3]).toMatchObject({ settingType: 'BOROUGH_AVAILABILITY', settingKey: '3:laptops', page: 0 });

      await page.getByTestId('history-type').selectOption({ label: 'All' });
      await expect.poll(() => requests.length).toBe(5);
      expect(requests[4].settingType ?? null).toBeNull();
    });

    test('paging requests the next page', async ({ page }) => {
      const requests: any[] = [];
      await installMocks(page, { requests, totalPages: 3 });
      await openHistory(page);
      await expect(page.getByText('Page 1 of 3')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
      await page.getByRole('button', { name: 'Next' }).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1]).toMatchObject({ page: 1 });
      await expect(page.getByText('Page 2 of 3')).toBeVisible();
    });

    test('refetches every time the tab is opened', async ({ page }) => {
      const requests: any[] = [];
      await installMocks(page, { requests });
      await openHistory(page);
      await expect(rows(page)).toHaveCount(5, { timeout: 15_000 });
      await page.getByRole('link', { name: 'Feature Flags' }).click();
      await page.getByRole('link', { name: 'History', exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
    });

    test('empty state', async ({ page }) => {
      await installMocks(page, { rows: [] });
      await openHistory(page);
      await expect(page.getByText('No changes recorded yet')).toBeVisible({ timeout: 15_000 });
    });

    test('error state', async ({ page }) => {
      await installMocks(page, { error: true });
      await openHistory(page);
      await expect(page.getByTestId('settings-history-error')).toBeVisible({ timeout: 15_000 });
      await expect(rows(page)).toHaveCount(0);
    });
  });
});
