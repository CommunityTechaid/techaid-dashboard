/**
 * Admin Panel → Delivery Configuration → Delivery Windows: the reported bug.
 *
 * Windows were only ever persisted by their own per-row Save button, but the prominent
 * "Save settings" button on the Booking Settings sub-tab saved config only (updateDeliveryConfig)
 * and still showed a green success toast — so staff edited a window's time, hit the big obvious
 * "Save settings" button, saw success, and the window edit was never sent. This spec pins the
 * fix: dirty tracking per row, a "Save all windows" button that actually calls saveDeliveryWindow,
 * a confirm() on leaving the sub-tab with unsaved rows, and the exact display-string round-trip
 * (server stores '2:00pm', the DeliveryCalendarInvite/.ics code on the server parses that exact
 * shape) that a naive re-serialisation could silently corrupt.
 *
 * Mirrors delivery-configuration-tab.spec.ts / borough-availability-admin.spec.ts for stubbing
 * idiom.
 *
 * @mocked — no token, all GraphQL stubbed, fake JWT from CI/save-token.mjs satisfies AuthGuard.
 */
import { test, expect, Page, Route, Locator } from '@playwright/test';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const CONFIG = {
  id: 'cfg-1',
  enabled: true,
  daysOfWeek: '1,2,3',
  leadTimeDays: 1,
  advanceDays: 4,
  boroughSchedulingEnabled: false,
  updatedAt: '2026-07-18T00:00:00Z',
};

const DAY_BOROUGHS = [{ dayOfWeek: 2, boroughs: ['Southwark'] }];

/** Stored server-side as '2:00pm' — must round-trip through the <input type="time"> as '14:00'. */
const WINDOW_MORNING = {
  id: 'win-1',
  name: 'Morning window',
  startTime: '2:00pm',
  endTime: '3:00pm',
  icon: '☀️',
  capacity: 5,
  sortOrder: 1,
  active: true,
};

interface MockOpts {
  windows?: any[];
  /** Every saveDeliveryWindow mutation body lands here. */
  capturedSaveWindow?: string[];
  /** Every updateDeliveryConfig mutation body lands here. */
  capturedUpdateConfig?: string[];
}

async function installMocks(page: Page, opts: MockOpts = {}): Promise<void> {
  const windows = opts.windows ?? [WINDOW_MORNING];

  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';

    if (body.includes('saveDeliveryWindow')) {
      opts.capturedSaveWindow?.push(body);
      const parsed = JSON.parse(body);
      const saved = {
        id: parsed.variables?.data?.id ?? `win-new-${(opts.capturedSaveWindow?.length ?? 1)}`,
        name: parsed.variables?.data?.name,
        startTime: parsed.variables?.data?.startTime,
        endTime: parsed.variables?.data?.endTime,
        icon: parsed.variables?.data?.icon,
        capacity: parsed.variables?.data?.capacity,
        sortOrder: parsed.variables?.data?.sortOrder,
        active: parsed.variables?.data?.active,
      };
      return fulfillJson(route, { data: { saveDeliveryWindow: saved } });
    }
    if (body.includes('updateDeliveryConfig')) {
      opts.capturedUpdateConfig?.push(body);
      return fulfillJson(route, { data: { updateDeliveryConfig: { ...CONFIG, updatedAt: '2026-08-20T00:00:00Z' } } });
    }
    if (body.includes('deliveryConfigAdmin')) {
      return fulfillJson(route, {
        data: {
          deliveryConfig: CONFIG,
          deliveryWindowsAdmin: windows,
          deliveryBlockedDates: [],
          deliveryDayBoroughs: DAY_BOROUGHS,
        },
      });
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
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

async function openWindowsSubTab(page: Page): Promise<void> {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'Delivery Configuration' }).click();
  await page.getByRole('link', { name: 'Delivery Windows' }).click();
  await expect(page.locator('.card', { hasText: 'Delivery windows' })).toBeVisible({ timeout: 15_000 });
}

/**
 * A window row carries its name in an input's *value*, not as text, so a `hasText`
 * filter never matches it. Read each row's name input instead.
 */
async function windowRow(page: Page, name: string): Promise<Locator> {
  const rows = page.locator('.row', { has: page.locator('input[type="time"]') });
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    if ((await row.locator('input').first().inputValue()) === name) return row;
  }
  throw new Error(`No delivery window row named "${name}"`);
}

test.describe('Delivery Windows — dirty tracking and save @mocked', () => {
  test('editing a window\'s time marks it "Unsaved changes", and "Save settings" does not persist it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const capturedSaveWindow: string[] = [];
    const capturedUpdateConfig: string[] = [];
    await installMocks(page, { capturedSaveWindow, capturedUpdateConfig });
    await openWindowsSubTab(page);

    const row = await windowRow(page, 'Morning window');
    await expect(row.locator('input[type="time"]').first()).toHaveValue('14:00');
    await row.locator('input[type="time"]').first().fill('15:00');

    await expect(row.getByText('Unsaved changes')).toBeVisible();

    // Switch to the Booking Settings sub-tab and press its "Save settings" button — the exact
    // click a staff member confused by the UI would make. Leaving the windows sub-tab while a
    // row is dirty now raises a confirm (that guard is itself part of this fix), so accept it:
    // the point of this test is what the Booking Settings save button sends, not the guard.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Booking Settings' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect.poll(() => capturedUpdateConfig.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(capturedSaveWindow, 'saveDeliveryWindow must NOT be sent by the Booking Settings save button').toHaveLength(0);
  });

  test('"Save all windows" sends one saveDeliveryWindow per dirty row and clears the badges', async ({ page }) => {
    test.setTimeout(60_000);
    const WINDOW_AFTERNOON = { ...WINDOW_MORNING, id: 'win-2', name: 'Afternoon window', startTime: '2:00pm', endTime: '4:00pm' };
    const capturedSaveWindow: string[] = [];
    await installMocks(page, { windows: [WINDOW_MORNING, WINDOW_AFTERNOON], capturedSaveWindow });
    await openWindowsSubTab(page);

    const morningRow = await windowRow(page, 'Morning window');
    const afternoonRow = await windowRow(page, 'Afternoon window');

    await morningRow.locator('input[type="time"]').first().fill('09:00');
    await afternoonRow.locator('input[type="time"]').first().fill('13:00');

    await expect(morningRow.getByText('Unsaved changes')).toBeVisible();
    await expect(afternoonRow.getByText('Unsaved changes')).toBeVisible();

    const saveAllButton = page.getByRole('button', { name: /Save.*2.*window/i });
    await expect(saveAllButton).toBeEnabled();
    await saveAllButton.click();

    await expect.poll(() => capturedSaveWindow.length, { timeout: 5_000 }).toBe(2);

    await expect(morningRow.getByText('Unsaved changes')).toHaveCount(0);
    await expect(afternoonRow.getByText('Unsaved changes')).toHaveCount(0);
  });

  test('a newly added window shows "Not saved yet" until saved', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaveWindow: string[] = [];
    await installMocks(page, { capturedSaveWindow });
    await openWindowsSubTab(page);

    await page.getByRole('button', { name: /Add window/ }).click();

    const rows = page.locator('.row', { has: page.locator('input[type="time"]') });
    const newRow = rows.last();
    await expect(newRow.getByText('Not saved yet')).toBeVisible();

    await newRow.locator('input.form-control').first().fill('New window');
    await newRow.locator('input[type="time"]').first().fill('09:00');
    await newRow.locator('input[type="time"]').nth(1).fill('10:00');

    await newRow.getByRole('button', { name: 'Create' }).click();

    await expect.poll(() => capturedSaveWindow.length, { timeout: 5_000 }).toBeGreaterThan(0);
    await expect(newRow.getByText('Not saved yet')).toHaveCount(0);
  });

  test('switching sub-tabs with dirty rows raises a confirm; dismissing it keeps you on the windows sub-tab', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openWindowsSubTab(page);

    const row = await windowRow(page, 'Morning window');
    await row.locator('input[type="time"]').first().fill('09:00');
    await expect(row.getByText('Unsaved changes')).toBeVisible();

    let dialogMessage = '';
    page.on('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss().catch(() => {});
    });

    await page.getByRole('link', { name: 'Booking Settings' }).click();

    expect(dialogMessage).toContain('unsaved change');
    // Dismissed — must still be on the windows sub-tab with the edit intact.
    await expect(page.locator('.card', { hasText: 'Delivery windows' })).toBeVisible();
    await expect(row.locator('input[type="time"]').first()).toHaveValue('09:00');
  });

  test('a stored "2:00pm" renders as 14:00, and saving 13:00 sends "1:00pm" in the mutation variables', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const capturedSaveWindow: string[] = [];
    await installMocks(page, { capturedSaveWindow });
    await openWindowsSubTab(page);

    const row = await windowRow(page, 'Morning window');
    await expect(row.locator('input[type="time"]').first()).toHaveValue('14:00');

    await row.locator('input[type="time"]').first().fill('13:00');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => capturedSaveWindow.length, { timeout: 5_000 }).toBeGreaterThan(0);
    const parsed = JSON.parse(capturedSaveWindow[0]);
    expect(parsed.variables?.data?.startTime, 'the display-string round trip must match the format the .ics/calendar-invite code parses').toBe('1:00pm');
  });
});
