/**
 * Admin Panel History tab: delivery-configuration entries (feedback from CEO UAT testing,
 * 2026-11-06 - a window capacity 4 -> 2 and a third delivery day were not in the history).
 * Server side: techaid-server records DELIVERY_CONFIG / DELIVERY_WINDOW / DELIVERY_BLOCKED_DATE /
 * DELIVERY_DAY_BOROUGH rows. Rows are stubbed so each display rule is pinned.
 *
 * @mocked - all GraphQL stubbed, Auth0 cache written directly; runs under the production CSP.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const admin = { source: 'USER', changedByName: 'Jo Smith', changedByEmail: 'jo@example.org' };
const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  changedAt: '2026-11-06T10:00:00Z',
  ...admin,
  subjectId: null,
  subjectLabel: null,
  ...extra,
});

const ROWS = [
  row('1', {
    settingType: 'DELIVERY_WINDOW', settingKey: '3', subjectId: '3', subjectLabel: '10-4',
    field: 'capacity', changeType: 'UPDATED', oldValue: '4', newValue: '2',
  }),
  row('2', {
    settingType: 'DELIVERY_CONFIG', settingKey: 'daysOfWeek', field: 'daysOfWeek',
    changeType: 'UPDATED', oldValue: '2,4', newValue: '2,4,5',
  }),
  row('3', {
    settingType: 'DELIVERY_WINDOW', settingKey: '9', subjectId: '9', subjectLabel: 'Evening',
    field: 'name', changeType: 'CREATED', oldValue: null, newValue: 'Evening',
  }),
  row('4', {
    settingType: 'DELIVERY_BLOCKED_DATE', settingKey: '2026-12-25', subjectId: '1', subjectLabel: '2026-12-25',
    field: 'reason', changeType: 'CREATED', oldValue: null, newValue: 'Christmas',
  }),
  row('5', {
    settingType: 'DELIVERY_BLOCKED_DATE', settingKey: '2026-12-25', subjectId: '1', subjectLabel: '2026-12-25',
    field: 'reason', changeType: 'DELETED', oldValue: 'Christmas', newValue: null,
  }),
  row('6', {
    settingType: 'DELIVERY_DAY_BOROUGH', settingKey: '2', subjectId: '2', subjectLabel: '2',
    field: 'boroughs', changeType: 'CREATED', oldValue: null, newValue: 'Lambeth,Southwark',
  }),
  row('7', {
    settingType: 'DELIVERY_CONFIG', settingKey: 'advanceDays', field: 'advanceDays',
    changeType: 'UPDATED', oldValue: '4', newValue: '6',
  }),
];

async function installMocks(page: Page, requests: any[]) {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('settingChanges')) {
      const variables = JSON.parse(raw).variables ?? {};
      requests.push(variables);
      return json({
        data: {
          settingChanges: {
            totalElements: ROWS.length, totalPages: 1, number: 0, size: 20, content: ROWS,
          },
        },
      });
    }
    if (raw.includes('featureFlagsPublic')) return json({ data: { featureFlagsPublic: [] } });
    if (raw.includes('featureFlags')) return json({ data: { featureFlags: [] } });
    return json({ data: {} });
  });
}

test.describe('settings history: delivery configuration @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await loginWith(page, ['app:admin']);
  });

  test('delivery rows read as sentences', async ({ page }) => {
    await installMocks(page, []);
    await page.goto('/dashboard/admin-panel');
    await page.getByRole('link', { name: 'History', exact: true }).click({ timeout: 15_000 });
    const rows = page.getByTestId('settings-history-row');
    await expect(rows).toHaveCount(ROWS.length, { timeout: 15_000 });
    const setting = (i: number) => rows.nth(i).getByTestId('history-setting');
    const change = (i: number) => rows.nth(i).getByTestId('history-change');

    await expect(setting(0)).toHaveText('Delivery window "10-4"');
    await expect(change(0)).toHaveText('capacity: 4 → 2');

    await expect(setting(1)).toHaveText('Delivery configuration');
    await expect(change(1)).toHaveText('Delivery days: Tue, Thu → Tue, Thu, Fri (added Fri)');

    await expect(setting(2)).toHaveText('Delivery window "Evening"');
    await expect(change(2)).toHaveText('name: (created) → Evening');

    await expect(setting(3)).toHaveText('Blocked delivery date 2026-12-25');
    await expect(change(3)).toHaveText('Date blocked: Christmas');
    await expect(change(4)).toHaveText('Date unblocked');

    await expect(setting(5)).toHaveText('Boroughs delivered to on Tuesday');
    await expect(change(5)).toHaveText('boroughs: (any borough) → Lambeth, Southwark');

    await expect(change(6)).toHaveText('delivery days offered ahead: 4 → 6');
  });

  test('delivery setting types can be filtered', async ({ page }) => {
    const requests: any[] = [];
    await installMocks(page, requests);
    await page.goto('/dashboard/admin-panel');
    await page.getByRole('link', { name: 'History', exact: true }).click({ timeout: 15_000 });
    await expect(page.getByTestId('settings-history-row')).toHaveCount(ROWS.length, { timeout: 15_000 });

    await page.getByTestId('history-type').selectOption({ label: 'Delivery windows' });
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({ settingType: 'DELIVERY_WINDOW' });
  });
});
