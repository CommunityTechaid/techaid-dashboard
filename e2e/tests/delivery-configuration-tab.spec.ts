/**
 * Admin Panel — "Delivery Configuration" tab.
 *
 * Booking Settings, Delivery Windows and Blocked Dates used to live on the "Delivery Slots"
 * tab (Distributions & Deliveries page) alongside the read-only "Who's booked" list. They now
 * live on their own Admin Panel tab (delivery-configuration.component.{ts,html}), split into
 * three nav-pills sub-tabs. This spec covers the navigation shape only — window save-dirtying
 * behaviour has its own spec (delivery-window-save.spec.ts).
 *
 * Mirrors borough-availability-admin.spec.ts: Admin Panel opened, GraphQL stubbed by inspecting
 * the raw request body.
 *
 * @mocked — no token, all GraphQL stubbed, fake JWT from CI/save-token.mjs satisfies AuthGuard.
 */
import { test, expect, Page, Route } from '@playwright/test';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';
const DISTRIBUTIONS_PATH = '/dashboard/distributions-and-deliveries';

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const CONFIG_DATA = {
  deliveryConfig: {
    id: 'cfg-1',
    enabled: true,
    daysOfWeek: '1,2,3',
    leadTimeDays: 1,
    advanceDays: 4,
    boroughSchedulingEnabled: false,
    updatedAt: '2026-07-18T00:00:00Z',
  },
  deliveryWindowsAdmin: [
    { id: 'win-1', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm', icon: '☀️', capacity: 5, sortOrder: 1, active: true },
  ],
  deliveryBlockedDates: [{ id: 'blk-1', date: '2026-12-25', reason: 'Christmas Day' }],
  deliveryDayBoroughs: [{ dayOfWeek: 2, boroughs: ['Southwark'] }],
};

async function installMocks(page: Page): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliveryConfigAdmin')) {
      return fulfillJson(route, { data: CONFIG_DATA });
    }
    if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
      return fulfillJson(route, { data: { deliveryBookingsAdmin: [] } });
    }
    if (body.includes('BoroughAvailabilityAdmin')) {
      return fulfillJson(route, { data: { boroughGroups: [], referrerLimitExceptions: [], adminConfig: null } });
    }
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    }
    if (body.includes('findAllDeviceRequests')) {
      return fulfillJson(route, { data: { deviceRequestConnection: { totalElements: 0, content: [] } } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

test.describe('Admin Panel — Delivery Configuration tab @mocked', () => {
  test('the Admin Panel offers a Delivery Configuration tab, and selecting it reveals three sub-tabs', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await page.goto(ADMIN_PANEL_PATH);

    const tabLink = page.getByRole('link', { name: 'Delivery Configuration' });
    await expect(tabLink).toBeVisible({ timeout: 15_000 });
    await tabLink.click();

    await expect(page.getByRole('link', { name: 'Booking Settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Delivery Windows' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Blocked Dates' })).toBeVisible();
  });

  test('each sub-tab shows its own panel, only one at a time', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Delivery Configuration' }).click();

    const settingsPanel = page.locator('.card', { hasText: 'Booking settings' });
    const windowsPanel = page.locator('.card', { hasText: 'Delivery windows' });
    const blockedPanel = page.locator('.card', { hasText: 'Blocked dates' });

    // Settings sub-tab is the default.
    await expect(settingsPanel).toBeVisible();
    await expect(windowsPanel).toBeHidden();
    await expect(blockedPanel).toBeHidden();

    await page.getByRole('link', { name: 'Delivery Windows' }).click();
    await expect(windowsPanel).toBeVisible();
    await expect(settingsPanel).toBeHidden();
    await expect(blockedPanel).toBeHidden();

    await page.getByRole('link', { name: 'Blocked Dates' }).click();
    await expect(blockedPanel).toBeVisible();
    await expect(settingsPanel).toBeHidden();
    await expect(windowsPanel).toBeHidden();
  });

  test('Delivery Slots no longer renders the settings/windows/blocked panels, and links to Admin Panel instead', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await page.goto(DISTRIBUTIONS_PATH);
    await page.getByRole('link', { name: 'Delivery Slots' }).click();

    await expect(page.getByText("Who's booked")).toBeVisible({ timeout: 15_000 });

    // The moved panels must be gone from this tab entirely.
    await expect(page.locator('.card', { hasText: 'Booking settings' })).toHaveCount(0);
    await expect(page.locator('.card', { hasText: 'Delivery windows' })).toHaveCount(0);
    await expect(page.locator('.card', { hasText: 'Blocked dates' })).toHaveCount(0);

    // The pointer link across to the new home is present instead.
    const pointerLink = page.getByRole('link', { name: /Admin Panel.*Delivery Configuration/ });
    await expect(pointerLink).toBeVisible();
    await expect(pointerLink).toHaveAttribute('href', '/dashboard/admin-panel');
  });

  test('turning on borough-specific delivery days reveals the per-day borough picker', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Delivery Configuration' }).click();

    const settingsPanel = page.locator('.card', { hasText: 'Booking settings' });
    await expect(settingsPanel).toBeVisible();

    const boroughSwitch = page.locator('#dsBoroughScheduling');
    await expect(boroughSwitch).not.toBeChecked();
    // Per-day picker is hidden while the switch is off — only its enabling switch is present.
    await expect(page.locator('#dayBorough-2-E09000028')).toHaveCount(0);

    await boroughSwitch.check();

    // Tue (day 2, enabled by CONFIG_DATA's daysOfWeek) gets a per-day picker with Southwark
    // ticked, matching CONFIG_DATA's deliveryDayBoroughs seed.
    const southwarkCheckbox = page.locator('#dayBorough-2-E09000028');
    await expect(southwarkCheckbox).toBeVisible();
    await expect(southwarkCheckbox).toBeChecked();
  });
});
