/**
 * Borough Availability admin tab (issue #179) — a borough-group x device-type matrix with
 * staged edits, saved wholesale in one mutation.
 *
 * Mirrors feature-flags-interpretability.spec.ts: the Admin Panel is opened, GraphQL is
 * stubbed by inspecting the raw request body, and Auth0 is a synthetic cache entry.
 *
 * Two load-bearing behaviours get their own tests rather than a passing mention:
 *  - the unsaved-change count is derived from a diff against the pristine snapshot, not an
 *    edit counter, so setting a cell back to its original value must clear it again; and
 *  - AUTO is not implemented server-side, so selecting it must surface an explicit warning
 *    rather than silently look like a working third state.
 *
 * @mocked — every GraphQL operation is page.route-stubbed and the Auth0 cache is written
 * directly, so no token is needed.
 */
import { test, expect, Page, Route } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';

const DEVICE_KEYS = [
  'laptops',
  'phones',
  'tablets',
  'allInOnes',
  'desktops',
  'commsDevices',
  'broadbandHubs',
  'other',
];

/** Production-shaped seed: an "all on" live group and a one-device pilot group. */
function seedGroups() {
  return [
    {
      id: '1',
      name: 'Lambeth & Southwark',
      boroughs: ['Lambeth', 'Southwark'],
      status: 'LIVE',
      maxPerReferee: 3,
      availability: DEVICE_KEYS.map((deviceType) => ({ deviceType, mode: 'ON' })),
      updatedAt: '2026-08-01T10:00:00Z',
    },
    {
      id: '2',
      name: 'Tower Hamlets',
      boroughs: ['Tower Hamlets'],
      status: 'PILOT',
      maxPerReferee: 1,
      availability: DEVICE_KEYS.map((deviceType) => ({
        deviceType,
        mode: deviceType === 'laptops' ? 'ON' : 'OFF',
      })),
      updatedAt: '2026-08-13T10:00:00Z',
    },
  ];
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

interface MockOpts {
  groups?: ReturnType<typeof seedGroups>;
  exceptions?: { id: string; organisationId: string; organisationName: string; boroughGroupId: string; maxPerReferee: number }[];
  /** Every SaveBoroughAvailability mutation body lands here, for "was it sent?" assertions. */
  capturedSaves?: string[];
  /** When set, BoroughAvailabilityAdmin replies with this GraphQL error instead of data. */
  loadError?: string;
  organisations?: { id: string; name: string }[];
}

async function installMocks(page: Page, opts: MockOpts = {}): Promise<void> {
  const groups = opts.groups ?? seedGroups();
  const exceptions = opts.exceptions ?? [];
  const organisations = opts.organisations ?? [{ id: '10', name: 'Example Org' }];

  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';

    if (body.includes('SaveBoroughAvailability')) {
      opts.capturedSaves?.push(body);
      const parsed = JSON.parse(body);
      return fulfillJson(route, { data: { saveBoroughAvailability: parsed.variables?.data?.groups ?? [] } });
    }
    if (body.includes('SearchReferringOrganisations')) {
      return fulfillJson(route, { data: { referringOrganisations: { content: organisations } } });
    }
    if (body.includes('BoroughAvailabilityAdmin')) {
      if (opts.loadError) {
        return fulfillJson(route, { errors: [{ message: opts.loadError }] });
      }
      return fulfillJson(route, { data: { boroughGroups: groups, referrerLimitExceptions: exceptions } });
    }
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, { data: { featureFlagsPublic: [] } });
    }
    if (body.includes('adminConfig')) {
      return fulfillJson(route, {
        data: {
          adminConfig: {
            id: '1',
            canPublicRequestSIMCard: false,
            canPublicRequestLaptop: false,
            canPublicRequestPhone: false,
            canPublicRequestBroadbandHub: false,
            canPublicRequestTablet: false,
            canPublicRequestDesktop: false,
            createdAt: null,
            updatedAt: null,
          },
        },
      });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

/** Opens the Admin Panel and switches to the Borough Availability tab. */
async function openAvailabilityTab(page: Page): Promise<void> {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'Borough Availability' }).click();
  await expect(page.locator('[data-testid="availability-matrix"]')).toBeVisible({ timeout: 15_000 });
}

function cell(page: Page, groupId: string, key: string) {
  return page.locator(`[data-testid="cell-${groupId}-${key}"]`);
}

test.describe('borough availability admin @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ['app:admin']);
  });

  test('renders the matrix with both groups and a status badge', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await expect(page.locator('[data-testid="group-row-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-row-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-row-2"]')).toContainText('PILOT');
    await expect(page.locator('[data-testid="group-row-2"]')).toContainText('Tower Hamlets');
  });

  test('cells reflect stored modes', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await expect(cell(page, '2', 'laptops')).toHaveAttribute('aria-label', /: ON$/);
    await expect(cell(page, '2', 'phones')).toHaveAttribute('aria-label', /: OFF$/);
  });

  test('clicking a cell opens the in-flow editor, only one at a time', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await cell(page, '2', 'phones').click();
    await expect(page.locator('[data-testid="cell-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(1);

    await cell(page, '2', 'laptops').click();
    await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(1);

    await page.locator('[data-testid="close-editor"]').click();
    await expect(page.locator('[data-testid="cell-editor"]')).toHaveCount(0);
  });

  test('changing a mode stages the change but does not save', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { capturedSaves });
    await openAvailabilityTab(page);

    await expect(page.locator('[data-testid="unsaved-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="save-availability"]')).toBeDisabled();

    await cell(page, '2', 'phones').click();
    await page.locator('[data-testid="mode-on"]').click();

    await expect(page.locator('[data-testid="unsaved-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="save-availability"]')).toBeEnabled();
    expect(capturedSaves).toHaveLength(0);
  });

  test('setting a value back to its original clears the unsaved state', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await cell(page, '2', 'phones').click();
    await page.locator('[data-testid="mode-on"]').click();
    await expect(page.locator('[data-testid="unsaved-count"]')).toBeVisible();

    await page.locator('[data-testid="mode-off"]').click();
    await expect(page.locator('[data-testid="unsaved-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="save-availability"]')).toBeDisabled();
  });

  test('AUTO surfaces its inert warning', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await cell(page, '2', 'phones').click();
    await page.locator('[data-testid="mode-auto"]').click();

    const warning = page.locator('[data-testid="auto-warning-2"]');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/not yet implemented/i);
    await expect(warning).toContainText(/Off/);
  });

  test('save sends the complete configuration, both groups, wholesale', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { capturedSaves });
    await openAvailabilityTab(page);

    await cell(page, '2', 'phones').click();
    await page.locator('[data-testid="mode-on"]').click();
    await page.locator('[data-testid="save-availability"]').click();

    await expect.poll(() => capturedSaves.length).toBe(1);
    const parsed = JSON.parse(capturedSaves[0]);
    const groups = parsed.variables?.data?.groups ?? [];
    expect(groups).toHaveLength(2);
    expect(groups.map((g: any) => g.id).sort()).toEqual(['1', '2']);

    const group2 = groups.find((g: any) => g.id === '2');
    const phonesEntry = group2.availability.find((a: any) => a.deviceType === 'phones');
    expect(phonesEntry.mode).toBe('ON');

    await expect(page.locator('#toast-container')).toContainText('Borough availability saved');
  });

  test('exceptions table: add, remove, and blocked save when incomplete', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { capturedSaves });
    await openAvailabilityTab(page);

    await expect(page.locator('[data-testid="no-exceptions"]')).toBeVisible();

    await page.locator('[data-testid="add-exception"]').click();
    await expect(page.locator('[data-testid="exceptions-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="exception-org-0"]')).toBeVisible();

    // A row with no organisation selected must block save, with an error toast and no mutation.
    await page.locator('[data-testid="save-availability"]').click();
    await expect(page.locator('#toast-container')).toContainText('Every exception needs an organisation and a borough group');
    expect(capturedSaves).toHaveLength(0);

    await page.locator('[data-testid="remove-exception-0"]').click();
    await expect(page.locator('[data-testid="no-exceptions"]')).toBeVisible();
  });

  test('a failed load is reported, not silent', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { loadError: 'boom' });
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Borough Availability' }).click();

    await expect(page.locator('[data-testid="availability-load-error"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="availability-matrix"]')).toHaveCount(0);
  });

  test('a failed load cannot be saved over the top of', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { loadError: 'boom', capturedSaves });
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Borough Availability' }).click();
    await expect(page.locator('[data-testid="availability-load-error"]')).toBeVisible({ timeout: 15_000 });

    // The regression this guards: a failed load left groups/exceptions empty while `pristine`
    // was still the empty string, so the two differed and the component reported itself dirty.
    // Save was enabled, and pressing it sent {groups: [], exceptions: []} to a mutation that
    // replaces the configuration wholesale — deleting every borough group and every exception.
    // A transient 500 on a routine page open was one click from wiping the config.
    await expect(page.locator('[data-testid="unsaved-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="save-availability"]')).toBeDisabled();

    // Force the click regardless of the disabled attribute — a future refactor that re-enables
    // the button must still not be able to send an empty configuration.
    await page.locator('[data-testid="save-availability"]').dispatchEvent('click');
    await page.waitForTimeout(500);
    expect(capturedSaves).toHaveLength(0);
  });
});
