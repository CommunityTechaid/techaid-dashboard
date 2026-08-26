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

/**
 * Everything offered service-wide. The default because the borough matrix is only meaningful
 * below a permissive global row — with a switch off, its whole column is disabled by design.
 */
const GLOBALS_ALL_ON = {
  id: '1',
  canPublicRequestLaptop: true,
  canPublicRequestPhone: true,
  canPublicRequestTablet: true,
  canPublicRequestDesktop: true,
  canPublicRequestSIMCard: true,
  canPublicRequestBroadbandHub: true,
  updatedAt: '2026-08-01T10:00:00Z',
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

interface MockOpts {
  groups?: ReturnType<typeof seedGroups>;
  exceptions?: { id: string; organisationId: string; organisationName: string; boroughGroupId: string; maxPerReferee: number }[];
  /** Every SaveBoroughAvailability mutation body lands here, for "was it sent?" assertions. */
  capturedSaves?: string[];
  /** Every SearchReferringOrganisations request body lands here, for "did it ask the right field?" assertions. */
  capturedOrgQueries?: string[];
  /** When set, BoroughAvailabilityAdmin replies with this GraphQL error instead of data. */
  loadError?: string;
  organisations?: { id: string; name: string }[];
  /** The global (service-wide) offer. Defaults to everything on. */
  adminConfig?: Record<string, unknown> | null;
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
      opts.capturedOrgQueries?.push(body);
      // The real schema has NO `content` field on `referringOrganisations` (it resolves to a
      // single ReferringOrganisation) — the field that paginates is `referringOrganisationsConnection`.
      // A component querying the wrong one gets rejected live with:
      //   Validation error (FieldUndefined@[referringOrganisations/content]) : Field 'content' in
      //   type 'ReferringOrganisation' is undefined
      // which meant the picker silently returned zero rows against the real API forever, and no
      // exception could ever be saved. This mock is written to agree with the REAL schema, not to
      // accommodate whatever the client happens to send — mirroring a wrong query back at itself
      // would hide this exact regression again.
      if (!body.includes('referringOrganisationsConnection')) {
        return fulfillJson(route, {
          errors: [
            {
              message:
                "Validation error (FieldUndefined@[referringOrganisations/content]) : Field 'content' in type 'ReferringOrganisation' is undefined",
            },
          ],
        });
      }
      return fulfillJson(route, { data: { referringOrganisationsConnection: { content: organisations } } });
    }
    if (body.includes('BoroughAvailabilityAdmin')) {
      if (opts.loadError) {
        return fulfillJson(route, { errors: [{ message: opts.loadError }] });
      }
      return fulfillJson(route, {
        data: {
          boroughGroups: groups,
          referrerLimitExceptions: exceptions,
          adminConfig: opts.adminConfig ?? GLOBALS_ALL_ON,
        },
      });
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

/** Opens the Admin Panel and switches to the Device Availability tab. */
async function openAvailabilityTab(page: Page): Promise<void> {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'Device Availability' }).click();
  await expect(page.locator('[data-testid="availability-matrix"]')).toBeVisible({ timeout: 15_000 });
}

function cell(page: Page, groupId: string, key: string) {
  return page.locator(`[data-testid="cell-${groupId}-${key}"]`);
}

test.describe('borough availability admin @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ['app:admin']);
  });

  test('the PILOT status renders as plain text, not a badge', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await expect(page.locator('[data-testid="group-row-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-row-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-row-2"]')).toContainText('Tower Hamlets');

    // An amber badge reads as "needs attention"; PILOT is a settled state of the group, not a
    // problem with it, so the status is plain muted text rather than a badge.
    const status = page.locator('[data-testid="group-status-2"]');
    await expect(status).toBeVisible();
    await expect(status).toContainText('PILOT');
    await expect(status).not.toHaveClass(/badge/);
    await expect(status.locator('.badge')).toHaveCount(0);
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

    await expect(page.locator('#toast-container')).toContainText('Availability saved');
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

  test('an organisation picked from the lookup saves as an exception', async ({ page }) => {
    /**
     * The bug this guards: the old control was a native `<input list=datalist>` bound to
     * free-text `organisationName`, and it only recorded `organisationId` when the typed text
     * matched an option's label character-for-character — including the " #10" id suffix nobody
     * would type. An admin who typed the organisation's name and pressed Save Configuration got
     * the toast "Every exception needs an organisation and a borough group" while looking at a
     * box that plainly showed the organisation's name. Selecting from the ng-select typeahead
     * must both silence that toast and stage the real id.
     */
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { capturedSaves });
    await openAvailabilityTab(page);

    await page.locator('[data-testid="add-exception"]').click();

    const orgSelect = page.locator('[data-testid="exception-org-0"]');
    await orgSelect.click();
    const searchResp = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('SearchReferringOrganisations'),
      { timeout: 10_000 },
    );
    await orgSelect.locator('.ng-input input').fill('Exa');
    await searchResp;

    const option = page.locator('.ng-option', { hasText: 'Example Org #10' });
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();

    await page.locator('[data-testid="exception-group-0"]').selectOption('2');
    await page.locator('[data-testid="exception-limit-0"]').fill('3');

    await page.locator('[data-testid="save-availability"]').click();
    await expect.poll(() => capturedSaves.length).toBe(1);

    const parsed = JSON.parse(capturedSaves[0]);
    expect(parsed.variables?.data?.exceptions).toEqual([
      { organisationId: '10', boroughGroupId: '2', maxPerReferee: 3 },
    ]);

    await expect(page.locator('#toast-container')).toContainText('Availability saved');
    await expect(page.locator('#toast-container')).not.toContainText('Every exception needs an organisation');
  });

  test('the organisation lookup queries the connection field the server actually exposes', async ({ page }) => {
    /**
     * Live UAT root cause behind the "cannot save an exception" report: the component's search
     * query asked for `referringOrganisations { content { id name } } }`, but on the real schema
     * `referringOrganisations` resolves to a SINGLE ReferringOrganisation with no `content` field.
     * The real API rejected every search with:
     *   Validation error (FieldUndefined@[referringOrganisations/content]) : Field 'content' in
     *   type 'ReferringOrganisation' is undefined
     * so the picker returned zero rows against the real API, always — no organisation id could
     * ever be recorded, and Save could only ever answer "Every exception needs an organisation
     * and a borough group". A mocked test could not see this on its own: the mock mirrored the
     * component's own (wrong) field name, so client and mock agreed with each other and
     * disagreed with the server. This test inspects the raw outgoing query instead of trusting
     * that a mock response arrived at all.
     */
    test.setTimeout(60_000);
    const capturedOrgQueries: string[] = [];
    await installMocks(page, { capturedOrgQueries });
    await openAvailabilityTab(page);

    await page.locator('[data-testid="add-exception"]').click();

    const orgSelect = page.locator('[data-testid="exception-org-0"]');
    await orgSelect.click();
    const searchResp = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('SearchReferringOrganisations'),
      { timeout: 10_000 },
    );
    await orgSelect.locator('.ng-input input').fill('Exa');
    await searchResp;

    expect(capturedOrgQueries.length).toBeGreaterThan(0);
    expect(capturedOrgQueries[0]).toContain('referringOrganisationsConnection');
    expect(capturedOrgQueries[0]).not.toMatch(/referringOrganisations\(/);
  });

  test("searching in one exception row does not blank another row's selection", async ({ page }) => {
    // The old shared results list: a search in the second row replaced the array driving both
    // rows' picker, so a valid earlier selection rendered as blank even though its id was still
    // staged for save. Each row now owns its own options list, seeded from its own last search.
    test.setTimeout(60_000);
    await installMocks(page);
    await openAvailabilityTab(page);

    await page.locator('[data-testid="add-exception"]').click();
    await page.locator('[data-testid="add-exception"]').click();

    const row0 = page.locator('[data-testid="exception-org-0"]');
    await row0.click();
    const row0Search = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('SearchReferringOrganisations'),
      { timeout: 10_000 },
    );
    await row0.locator('.ng-input input').fill('Exa');
    await row0Search;
    const row0Option = page.locator('.ng-option', { hasText: 'Example Org #10' });
    await row0Option.waitFor({ state: 'visible', timeout: 10_000 });
    await row0Option.click();

    await expect(row0.locator('.ng-value-label')).toContainText('Example Org');

    // Registered AFTER installMocks on purpose, same pattern as the global-row test below: a
    // subsequent SearchReferringOrganisations call gets a different organisation list, and
    // everything else falls back to the general mock.
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('SearchReferringOrganisations')) {
        return fulfillJson(route, { data: { referringOrganisationsConnection: { content: [{ id: '20', name: 'Other Org' }] } } });
      }
      return route.fallback();
    });

    const row1 = page.locator('[data-testid="exception-org-1"]');
    await row1.click();
    const row1Search = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('SearchReferringOrganisations'),
      { timeout: 10_000 },
    );
    await row1.locator('.ng-input input').fill('Oth');
    await row1Search;
    await page.locator('.ng-option', { hasText: 'Other Org #20' }).waitFor({ state: 'visible', timeout: 10_000 });

    // Row 0's selection must still be intact: the search in row 1 must not have replaced it.
    await expect(row0.locator('.ng-value-label')).toContainText('Example Org');
  });

  test('searching an exception org does not itself mark the config dirty', async ({ page }) => {
    // Only {organisationId, boroughGroupId, maxPerReferee} are snapshotted for exceptions — the
    // per-row options list and search Subject are not, so merely searching (without changing the
    // selection) must not flip the header into "unsaved changes".
    test.setTimeout(60_000);
    await installMocks(page, {
      exceptions: [
        { id: 'e1', organisationId: '10', organisationName: 'Example Org', boroughGroupId: '1', maxPerReferee: 2 },
      ],
    });
    await openAvailabilityTab(page);

    await expect(page.locator('[data-testid="unsaved-count"]')).toHaveCount(0);

    const row0 = page.locator('[data-testid="exception-org-0"]');
    await row0.click();
    const searchResp = page.waitForResponse(
      (r) => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('SearchReferringOrganisations'),
      { timeout: 10_000 },
    );
    await row0.locator('.ng-input input').fill('Exa');
    await searchResp;

    await expect(page.locator('[data-testid="unsaved-count"]')).toHaveCount(0);
  });

  test('a failed load is reported, not silent', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { loadError: 'boom' });
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Device Availability' }).click();

    await expect(page.locator('[data-testid="availability-load-error"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="availability-matrix"]')).toHaveCount(0);
  });

  test('a failed load cannot be saved over the top of', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    await installMocks(page, { loadError: 'boom', capturedSaves });
    await page.goto(ADMIN_PANEL_PATH);
    await page.getByRole('link', { name: 'Device Availability' }).click();
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

/**
 * The global row, absorbed from the old Application Configuration tab.
 *
 * It exists because the relationship was invisible while the two lived on separate tabs: the six
 * `canPublicRequest*` switches are the ceiling for the whole matrix, so a device switched off
 * globally cannot be offered by any borough — and an admin who switched a borough on regardless
 * saw a successful save and no change on the request form, with nothing to explain why.
 */
test.describe("device availability global row @mocked", () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ["app:admin"]);
  });

  test("a globally-off device disables that column for every borough", async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { adminConfig: { ...GLOBALS_ALL_ON, canPublicRequestPhone: false } });
    await openAvailabilityTab(page);

    // Disabled, not hidden — the borough setting is still real, just outranked.
    await expect(cell(page, "1", "phones")).toBeDisabled();
    await expect(cell(page, "2", "phones")).toBeDisabled();
    await expect(cell(page, "1", "phones")).toHaveAttribute("aria-label", /switched off for all boroughs/);

    // A column that IS on globally stays editable, so this is the switch talking and not a
    // wholesale lockout.
    await expect(cell(page, "1", "laptops")).toBeEnabled();
  });

  test("toggling a global switch stages a change and sends updateAdminConfig on save", async ({ page }) => {
    test.setTimeout(60_000);
    const capturedSaves: string[] = [];
    let globalUpdate: string | null = null;

    await installMocks(page, { capturedSaves });
    // Registered AFTER installMocks on purpose: Playwright matches routes in reverse registration
    // order, so the last one wins and everything it does not claim falls back to the general mock.
    await page.route("**/graphql", async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes("UpdateAdminConfig")) {
        globalUpdate = body;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { updateAdminConfig: GLOBALS_ALL_ON } }),
        });
      }
      return route.fallback();
    });
    await openAvailabilityTab(page);

    await page.locator("[data-testid=\"global-cell-tablets\"]").click();
    await expect(page.locator("[data-testid=\"unsaved-count\"]")).toContainText("1 unsaved change");

    await page.locator("[data-testid=\"save-availability\"]").click();
    await expect(page.locator("#toast-container")).toContainText("Availability saved");

    expect(globalUpdate).toContain("canPublicRequestTablet");
    // The matrix itself did not change, so the borough half must not have been sent — the two
    // records are saved independently to keep the ordinary save a single call.
    expect(capturedSaves).toHaveLength(0);
  });
});
