/**
 * Feature Flags admin tab — every flag must be interpretable (issue #174).
 *
 * The page renders friendly copy from a FLAG_LABELS map keyed by flag key. Before #174
 * only two of the five live flags had an entry, so the rest rendered a raw kebab-case key
 * and — because the description was an empty string behind an @if — no description at all.
 * The failure mode is silent and recurs every time a flag is seeded server-side without
 * matching copy landing here, which is exactly why it went unnoticed.
 *
 * The load-bearing assertion is the LAST one: it walks whatever the server returned and
 * requires a real label and a non-empty description for each. A future flag added without
 * copy fails this spec rather than quietly shipping a blank row.
 *
 * The other assertions pin the meaning-carrying parts that a bare on/off switch cannot
 * convey: that "off" is shadow mode for the two enforcement guards, and that the GDPR job
 * is a compliance control whose off switch is confirmed rather than one-click.
 *
 * @mocked — every GraphQL operation is page.route-stubbed and the Auth0 cache is written
 * directly, so no token is needed.
 */
import { test, expect, Page, Route } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const ADMIN_PANEL_PATH = '/dashboard/admin-panel';

/** The five flags seeded in techaid-server, plus the one added for borough support. */
const SERVER_FLAGS = [
  { key: 'delivery-booking', enabled: false, updatedAt: '2026-08-01T10:00:00Z' },
  { key: 'update-scanner', enabled: false, updatedAt: '2026-08-01T10:00:00Z' },
  { key: 'wipe-cert-enforcement', enabled: false, updatedAt: '2026-08-01T10:00:00Z' },
  { key: 'blocking-flag-enforcement', enabled: false, updatedAt: '2026-08-01T10:00:00Z' },
  { key: 'gdpr-in-app-cleanup', enabled: true, updatedAt: '2026-08-12T10:00:00Z' },
  { key: 'tower-hamlets-borough-support', enabled: false, updatedAt: '2026-08-13T10:00:00Z' },
];

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

interface MockOpts {
  flags?: { key: string; enabled: boolean; updatedAt?: string }[];
  /** Every updateFeatureFlag mutation body lands here, for "was it sent?" assertions. */
  capturedUpdates?: string[];
  /** When set, updateFeatureFlag replies with this GraphQL error instead of succeeding. */
  updateError?: string;
}

async function installMocks(page: Page, opts: MockOpts = {}): Promise<void> {
  const flags = opts.flags ?? SERVER_FLAGS;
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('updateFeatureFlag')) {
      opts.capturedUpdates?.push(body);
      if (opts.updateError) {
        return fulfillJson(route, { errors: [{ message: opts.updateError }] });
      }
      const parsed = JSON.parse(body);
      const data = parsed.variables?.data ?? {};
      return fulfillJson(route, {
        data: { updateFeatureFlag: { key: data.key, enabled: data.enabled, updatedAt: '2026-08-13T23:00:00Z' } },
      });
    }
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, { data: { featureFlagsPublic: flags.map(({ key, enabled }) => ({ key, enabled })) } });
    }
    if (body.includes('featureFlags')) {
      return fulfillJson(route, { data: { featureFlags: flags } });
    }
    if (body.includes('adminConfig')) {
      return fulfillJson(route, { data: { adminConfig: { id: '1', canPublicRequestSIMCard: false, canPublicRequestLaptop: false, canPublicRequestPhone: false, canPublicRequestBroadbandHub: false, canPublicRequestTablet: false, canPublicRequestDesktop: false, createdAt: null, updatedAt: null } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

/** Opens the Admin Panel and switches to the Feature Flags tab. */
async function openFlagsTab(page: Page): Promise<void> {
  await page.goto(ADMIN_PANEL_PATH);
  await page.getByRole('link', { name: 'Feature Flags' }).click();
  await expect(page.locator('app-feature-flags')).toBeVisible({ timeout: 15_000 });
  // Rows only exist once the query resolves.
  await expect(page.locator('app-feature-flags .border-bottom').first()).toBeVisible({ timeout: 15_000 });
}

/** The row block for a given flag key, located via the raw key the page now renders. */
function rowFor(page: Page, key: string) {
  return page.locator('app-feature-flags .border-bottom').filter({ has: page.locator('.flag-key', { hasText: key }) });
}

test.describe('feature flags interpretability @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ['app:admin']);
  });

  test('renders a human-readable label, not the raw key, for every seeded flag', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openFlagsTab(page);

    // Before #174 these three rendered their kebab key as the heading.
    await expect(rowFor(page, 'wipe-cert-enforcement')).toContainText('Require Wipe Certificate Before Allocation');
    await expect(rowFor(page, 'blocking-flag-enforcement')).toContainText('Block Allocation of Flagged Devices');
    await expect(rowFor(page, 'gdpr-in-app-cleanup')).toContainText('GDPR Retention Cleanup');
    await expect(rowFor(page, 'tower-hamlets-borough-support')).toContainText('Tower Hamlets Borough Support');
  });

  test('says that OFF is shadow mode for the two enforcement guards', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    await openFlagsTab(page);

    // The whole point: a bare on/off switch implies "off = not checked", which is wrong
    // for these two. If this wording is lost the page is actively misleading again.
    for (const key of ['wipe-cert-enforcement', 'blocking-flag-enforcement']) {
      await expect(rowFor(page, key)).toContainText('Off does NOT mean unchecked');
      await expect(rowFor(page, key)).toContainText('shadow mode');
    }
  });

  test('marks the GDPR job as a compliance control and confirms before switching it off', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: string[] = [];
    await installMocks(page, { capturedUpdates });
    await openFlagsTab(page);

    const gdprRow = rowFor(page, 'gdpr-in-app-cleanup');
    await expect(gdprRow).toContainText('Compliance control');
    await expect(gdprRow).toContainText('no GDPR retention runs at all');

    // Dismissing the confirmation must leave the flag alone — no mutation at all.
    page.once('dialog', (dialog) => dialog.dismiss());
    await gdprRow.locator('input[type="checkbox"]').click();
    await expect(gdprRow.locator('input[type="checkbox"]')).toBeChecked();
    expect(capturedUpdates).toHaveLength(0);

    // Accepting it goes through.
    page.once('dialog', (dialog) => dialog.accept());
    await gdprRow.locator('input[type="checkbox"]').click();
    await expect.poll(() => capturedUpdates.length).toBe(1);
    expect(capturedUpdates[0]).toContain('gdpr-in-app-cleanup');
  });

  test('a non-critical flag toggles without a confirmation prompt', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: string[] = [];
    await installMocks(page, { capturedUpdates });
    await openFlagsTab(page);

    // Guards the confirm from creeping onto every flag: only critical ones prompt.
    let dialogSeen = false;
    page.on('dialog', (dialog) => { dialogSeen = true; return dialog.accept(); });

    await rowFor(page, 'delivery-booking').locator('input[type="checkbox"]').click();
    await expect.poll(() => capturedUpdates.length).toBe(1);
    expect(dialogSeen).toBe(false);
  });

  test('the switch does not lie when the save fails', async ({ page }) => {
    test.setTimeout(60_000);
    // `[checked]` is a one-way binding, so a rejected write leaves the DOM switch flipped
    // while the stored value is unchanged — the switch would report a state the server
    // does not hold. Guards the manual restore in toggle().
    await installMocks(page, { updateError: 'nope' });
    await openFlagsTab(page);

    const row = rowFor(page, 'delivery-booking');
    const toggleInput = row.locator('input[type="checkbox"]');
    await expect(toggleInput).not.toBeChecked();

    await toggleInput.click();
    await expect(toggleInput).not.toBeChecked();
  });

  test('every flag the server returns has a label and a non-empty description', async ({ page }) => {
    test.setTimeout(60_000);
    // An unknown key stands in for a flag seeded server-side before its copy lands here.
    const flags = [...SERVER_FLAGS, { key: 'some-future-flag', enabled: false, updatedAt: '2026-09-01T10:00:00Z' }];
    await installMocks(page, { flags });
    await openFlagsTab(page);

    const rows = page.locator('app-feature-flags .border-bottom');
    await expect(rows).toHaveCount(flags.length);

    for (const { key } of flags) {
      const row = rowFor(page, key);
      await expect(row).toHaveCount(1);
      // The description sits between the key and the toggle; assert it is real text and
      // not the empty string that used to render as a blank gap.
      const text = (await row.innerText()).replace(key, '').trim();
      expect(text.length, `flag ${key} rendered no descriptive copy`).toBeGreaterThan(40);
    }

    // The unknown key still gets an explicit fallback rather than a silent blank.
    await expect(rowFor(page, 'some-future-flag')).toContainText('No description recorded for this flag yet');
  });
});
