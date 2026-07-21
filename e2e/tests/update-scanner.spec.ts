/**
 * Update Scanner — bench scanning page for device status updates (roadmap SE2).
 *
 * An operator arms a mode once (scan a printed `CTA*…` card, or pick from the
 * dropdown) then rapid-scans device barcodes; each scan sets the armed status
 * with no further clicks.
 *
 * The important tests here are the REFUSALS. `updateKits` performs no
 * sub-status validation server-side (techaid-server KitMutations.kt:176 applies
 * the status blindly), so the client-side blocking-flag rule mirrored from
 * kit-info's `disabledStatusGroup` is the ONLY thing stopping a flagged device
 * being marked QC-complete. Every "no mutation was sent" assertion below is
 * load-bearing, not decoration.
 *
 * @mocked — every GraphQL operation is page.route-stubbed and the Auth0 cache
 * is written directly, because the page is gated on the `app:bulkedit`
 * authority which the CI fake token deliberately does not carry.
 */
import { test, expect, Page, Route } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const SCANNER_PATH = '/dashboard/devices/update-scanner';

interface MockKit {
  id: string;
  make: string | null;
  model: string | null;
  status: string;
  archived: boolean;
  subStatus: Record<string, boolean> | null;
}

const SUB_STATUS_CLEAR = {
  wipeFailed: false,
  installationOfOSFailed: false,
  needsFurtherInvestigation: false,
  needsSparePart: false,
  lockedToUser: false,
};

function kitFixture(id: number, overrides: Partial<MockKit> = {}): MockKit {
  return {
    id: String(id),
    make: 'Dell',
    model: 'Latitude 5490',
    status: 'PROCESSING_WIPED',
    archived: false,
    subStatus: { ...SUB_STATUS_CLEAR },
    ...overrides,
  };
}

interface MockOpts {
  kits?: Record<string, MockKit>;
  /** Value of the `update-scanner` server feature flag. */
  flagEnabled?: boolean;
  /** Every updateKits mutation body lands here, for "was it sent?" assertions. */
  capturedUpdates?: any[];
  /** When set, updateKits replies with this GraphQL error message instead. */
  updateError?: string;
}

async function installMocks(page: Page, opts: MockOpts = {}): Promise<void> {
  const kits = opts.kits ?? {};
  const capturedUpdates = opts.capturedUpdates ?? [];

  await page.route('**/graphql', async (route: Route) => {
    const body = route.request().postData() ?? '';
    let parsed: any = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* ignore */
    }

    const reply = (data: any) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (body.includes('featureFlagsPublic')) {
      return reply({
        featureFlagsPublic: [
          { key: 'delivery-booking', enabled: false },
          { key: 'update-scanner', enabled: !!opts.flagEnabled },
        ],
      });
    }
    if (body.includes('buildInfo')) {
      return reply({ buildInfo: { version: '1.0.0-test', commit: 'abc123', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('updateKits')) {
      capturedUpdates.push(parsed);
      if (opts.updateError) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ errors: [{ message: opts.updateError }] }),
        });
      }
      const ids: string[] = parsed?.variables?.ids ?? [];
      const status: string = parsed?.variables?.status;
      ids.forEach(id => {
        if (kits[String(id)]) {
          kits[String(id)] = { ...kits[String(id)], status };
        }
      });
      return reply({ updateKits: ids.map(id => ({ id: String(id), status })) });
    }
    if (body.includes('scannerKit')) {
      const id = String(parsed?.variables?.id);
      return reply({ kit: kits[id] ?? null });
    }
    return reply({});
  });
}

function scanField(page: Page) {
  return page.getByTestId('scanner-field');
}

async function scan(page: Page, raw: string): Promise<void> {
  const field = scanField(page);
  await field.fill(raw);
  await field.press('Enter');
}

async function openScanner(page: Page): Promise<void> {
  await page.goto(SCANNER_PATH);
  await expect(scanField(page)).toBeVisible({ timeout: 15_000 });
}

const banner = (page: Page) => page.getByTestId('scanner-banner');
const armBanner = (page: Page) => page.getByTestId('scanner-arm-banner');

test.describe('update scanner access gating @mocked', () => {
  test('without app:bulkedit and with the flag off, the page is not reachable', async ({ page }) => {
    test.setTimeout(60_000);
    await authenticateWithPermissions(page, ['read:kits']);
    await installMocks(page, { flagEnabled: false });

    await page.goto(SCANNER_PATH);

    // Redirected away — the scan field never renders.
    await expect(page).not.toHaveURL(/update-scanner/, { timeout: 15_000 });
    await expect(scanField(page)).toHaveCount(0);
  });

  test('the update-scanner flag widens access to staff without app:bulkedit', async ({ page }) => {
    test.setTimeout(60_000);
    await authenticateWithPermissions(page, ['read:kits']);
    await installMocks(page, { flagEnabled: true });

    await openScanner(page);
    await expect(page).toHaveURL(/update-scanner/);
  });
});

test.describe('update scanner arm and apply @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateWithPermissions(page, ['app:bulkedit', 'read:kits', 'write:kits']);
  });

  test('scanning a mode card arms the mode; a device scan then applies it', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: { '19245': kitFixture(19245) },
      capturedUpdates,
    });

    await openScanner(page);
    await expect(armBanner(page)).toContainText('NOT ARMED');
    await expect(banner(page)).toContainText('Not armed. Scan a mode card or choose a mode to start.');

    await scan(page, 'CTA*OS-INSTALLED');
    await expect(armBanner(page)).toContainText('ARMED');
    await expect(armBanner(page)).toContainText('OS installed');
    await expect(banner(page)).toContainText(
      'Armed: OS installed. Scan devices now — each is set to OS installed.',
    );

    await scan(page, '19245');
    await expect(banner(page)).toContainText('#19245 · Dell Latitude 5490 → OS installed ✓', {
      timeout: 15_000,
    });

    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].variables.ids).toEqual(['19245']);
    expect(capturedUpdates[0].variables.status).toBe('PROCESSING_OS_INSTALLED');

    // Session tally counts the applied device.
    await expect(page.getByTestId('scanner-tally-total')).toHaveText('1');
  });

  test('focus returns to the scan field after every scan', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { kits: { '19245': kitFixture(19245) } });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19245');
    await expect(banner(page)).toContainText('→ OS installed ✓', { timeout: 15_000 });

    await expect(scanField(page)).toBeFocused();
    // …and the field is cleared, ready for the next device.
    await expect(scanField(page)).toHaveValue('');
  });

  test('a device flag blocks the QC mode and sends no mutation', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: {
        '19246': kitFixture(19246, {
          subStatus: { ...SUB_STATUS_CLEAR, needsSparePart: true },
        }),
      },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*QC-COMPLETE');
    await scan(page, '19246');

    await expect(banner(page)).toContainText(
      "#19246 can't move to Quality check completed — a device flag is set (e.g. needs spare part). " +
        'Clear it on the device record first.',
      { timeout: 15_000 },
    );
    expect(capturedUpdates).toHaveLength(0);
  });

  test('the same device flag does NOT block the OS-installed mode', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: {
        '19246': kitFixture(19246, {
          subStatus: { ...SUB_STATUS_CLEAR, needsSparePart: true },
        }),
      },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19246');

    await expect(banner(page)).toContainText('→ OS installed ✓', { timeout: 15_000 });
    expect(capturedUpdates).toHaveLength(1);
  });

  test('a device already in the target status is reported, not re-sent', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: { '19247': kitFixture(19247, { status: 'PROCESSING_OS_INSTALLED' }) },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19247');

    await expect(banner(page)).toContainText('#19247 is already OS installed. No change made.', {
      timeout: 15_000,
    });
    expect(capturedUpdates).toHaveLength(0);
  });

  test('an archived device is refused', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: { '19248': kitFixture(19248, { archived: true }) },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19248');

    await expect(banner(page)).toContainText("#19248 is archived and can't be updated.", {
      timeout: 15_000,
    });
    expect(capturedUpdates).toHaveLength(0);
  });

  test('an unknown id is reported without a mutation', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, { kits: {}, capturedUpdates });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '11111');

    await expect(banner(page)).toContainText('No device found for #11111. Check the label and scan again.', {
      timeout: 15_000,
    });
    expect(capturedUpdates).toHaveLength(0);
  });

  test('a barcode that is neither a device nor a mode card is surfaced verbatim', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);

    await openScanner(page);
    await scan(page, 'HELLO-WORLD');

    await expect(banner(page)).toContainText(
      "Didn't recognise 'HELLO-WORLD'. Not a device barcode or a mode card.",
    );
  });

  test('rescanning a device already handled this session reports the duplicate', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: { '19249': kitFixture(19249) },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19249');
    await expect(banner(page)).toContainText('→ OS installed ✓', { timeout: 15_000 });

    await scan(page, '19249');
    await expect(banner(page)).toContainText('#19249 already set to OS installed at', { timeout: 15_000 });
    await expect(banner(page)).toContainText('No change.');

    // Still exactly one mutation — the duplicate was not re-sent.
    expect(capturedUpdates).toHaveLength(1);
  });

  test('disarming pauses the loop and device scans stop applying', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdates: any[] = [];
    await installMocks(page, {
      kits: { '19250': kitFixture(19250) },
      capturedUpdates,
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await expect(armBanner(page)).toContainText('ARMED');

    await scan(page, 'CTA*DISARM');
    await expect(armBanner(page)).toContainText('NOT ARMED');
    await expect(banner(page)).toContainText('Disarmed. Scanning paused until you arm a mode.');

    await scan(page, '19250');
    await expect(banner(page)).toContainText('Not armed. Scan a mode card or choose a mode to start.');
    expect(capturedUpdates).toHaveLength(0);
  });

  test('the session summary appears on disarm, not mid-session', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { kits: { '19253': kitFixture(19253) } });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19253');
    await expect(banner(page)).toContainText('→ OS installed ✓', { timeout: 15_000 });

    // "Session complete" would read wrong while scans are still coming in.
    await expect(page.getByTestId('scanner-session-summary')).toHaveCount(0);

    await scan(page, 'CTA*DISARM');
    await expect(page.getByTestId('scanner-session-summary')).toHaveText(
      'Session complete — 1 updated. 1 OS · 0 QC · 0 assessment.',
    );
  });

  test('a server rejection is surfaced in the banner, not swallowed', async ({ page }) => {
    // Pins the wipe-cert guard path (techaid-server#81): once that flag is on it
    // rejects the PROCESSING_OS_INSTALLED jump with a BAD_REQUEST naming the kit.
    test.setTimeout(60_000);
    await installMocks(page, {
      kits: { '19251': kitFixture(19251) },
      updateError: 'Kit 19251 has no wipe certificate reference recorded',
    });

    await openScanner(page);
    await scan(page, 'CTA*OS-INSTALLED');
    await scan(page, '19251');

    await expect(banner(page)).toContainText('no wipe certificate reference recorded', { timeout: 15_000 });
  });

  test('the mode dropdown arms without a printed card', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, { kits: { '19252': kitFixture(19252) } });

    await openScanner(page);
    await page.getByTestId('scanner-mode-select').selectOption('ALLOCATION_READY');

    await expect(armBanner(page)).toContainText('Assessment check completed');
    await expect(banner(page)).toContainText('Armed: Assessment check completed.');
  });
});
