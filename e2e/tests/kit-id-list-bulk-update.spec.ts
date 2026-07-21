/**
 * kit-index comma-separated ID search + safer bulk update.
 *
 * Covers the four behaviours added for pasting a batch of CTA device IDs into
 * the Devices search box:
 *
 *   1. an ID-list term filters the table server-side (`term: ""` plus an
 *      `id: { _in: [...] }` constraint merged onto the active filter),
 *   2. IDs that didn't match are named, and the "Active devices only" default
 *      is called out as the likely reason,
 *   3. "Select all N matched" selects the whole matched set — including the
 *      devices that live on a later page,
 *   4. the bulk-update modal warns when the selection spans several statuses.
 *
 * @mocked — every GraphQL operation is page.route-stubbed and the Auth0 cache
 * is written directly, because the bulk-edit UI is gated on the `app:bulkedit`
 * authority which the CI fake token deliberately does not carry.
 */
import { test, expect, Page } from '@playwright/test';

const CLIENT_ID = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX';
const AUDIENCE = 'https://api.communitytechaid.org.uk';
const SCOPE = 'openid profile email offline_access';
const LEGACY_SCOPE = 'openid profile email';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Writes an auth0-spa-js v2 cache entry carrying the given permissions. The SDK
 * never re-verifies the signature of a *cached* token, only its shape/expiry —
 * see e2e/save-token.mjs for the derivation of this structure.
 */
async function authenticateWithPermissions(page: Page, permissions: string[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7200;
  const accessToken = [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e-synthetic' }),
    b64url({
      iss: 'https://techaid-auth.eu.auth0.com/',
      sub: 'auth0|e2e-bulk-edit',
      aud: [AUDIENCE],
      iat: now,
      exp,
      scope: SCOPE,
      permissions,
    }),
    'e2e_placeholder_sig',
  ].join('.');

  const idTokenClaims = {
    sub: 'auth0|e2e-bulk-edit',
    aud: CLIENT_ID,
    iss: 'https://techaid-auth.eu.auth0.com/',
    iat: now,
    exp,
    email: 'e2e@example.com',
    name: 'E2E Bulk Editor',
  };
  const idToken = [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e-synthetic' }),
    b64url(idTokenClaims),
    'e2e_placeholder_sig',
  ].join('.');
  const decodedToken = {
    claims: idTokenClaims,
    user: { sub: idTokenClaims.sub, email: idTokenClaims.email, name: idTokenClaims.name },
  };
  const body = {
    access_token: accessToken,
    id_token: idToken,
    scope: SCOPE,
    expires_in: 7200,
    token_type: 'Bearer',
    audience: AUDIENCE,
    client_id: CLIENT_ID,
    decodedToken,
  };

  const entries: Array<[string, string]> = [
    [`@@auth0spajs@@::${CLIENT_ID}::${AUDIENCE}::${SCOPE}`, JSON.stringify({ body, expiresAt: exp })],
    [
      `@@auth0spajs@@::${CLIENT_ID}::${AUDIENCE}::${LEGACY_SCOPE}`,
      JSON.stringify({ body: { ...body, scope: LEGACY_SCOPE }, expiresAt: exp }),
    ],
    [`@@auth0spajs@@::${CLIENT_ID}::@@user@@`, JSON.stringify({ id_token: idToken, decodedToken })],
  ];

  await page.context().addCookies([
    {
      name: `auth0.${CLIENT_ID}.is.authenticated`,
      value: 'true',
      domain: 'localhost',
      path: '/',
      expires: exp,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.addInitScript(pairs => {
    for (const [key, value] of pairs as Array<[string, string]>) {
      window.localStorage.setItem(key, value);
    }
    // Devices default to Active-only; pin it so the archived callout is deterministic.
    window.localStorage.setItem('kitFilters-kit-index', JSON.stringify({ archived: [false] }));
  }, entries);
}

// 14 pasted IDs; 1001–1012 exist, 1013–1014 do not (the "archived trap" case).
const REQUESTED_IDS = Array.from({ length: 14 }, (_, i) => 1001 + i);
const MATCHED = REQUESTED_IDS.slice(0, 12).map((id, i) => ({
  id,
  // 10 at one stage, 2 at another → the mixed-status warning must appear.
  status: i < 10 ? 'ALLOCATION_READY' : 'PROCESSING_START',
}));
const MISSING_IDS = REQUESTED_IDS.slice(12);
const PAGE_SIZE = 10;

const kitRow = (id: number, status: string) => ({
  id,
  make: 'Dell',
  model: `Latitude ${id}`,
  age: 2,
  type: 'LAPTOP',
  status,
  location: 'Brixton store',
  updatedAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  lotId: null,
  donor: null,
  deviceRequest: null,
});

// Devices returned when no ID-list search is active.
const BASELINE = [
  { id: 900, status: 'DONATION_NEW' },
  { id: 901, status: 'DONATION_NEW' },
];

async function fulfill(route: import('@playwright/test').Route, data: any) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

interface Recorded {
  findAllKits: any[];
  lookup: any[];
}

async function stubGraphql(page: Page, recorded: Recorded): Promise<void> {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* non-JSON body — fall through to the empty response */
    }
    const vars = parsed.variables ?? {};

    if (raw.includes('buildInfo')) {
      return fulfill(route, {
        buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' },
      });
    }

    if (raw.includes('findKitsByIdList')) {
      recorded.lookup.push(vars);
      return fulfill(route, {
        kitsConnection: {
          totalElements: MATCHED.length,
          content: MATCHED.map(k => ({ id: k.id, status: k.status })),
        },
      });
    }

    if (raw.includes('findAllKits')) {
      recorded.findAllKits.push(vars);
      const requestedIds: number[] = idsFromWhere(vars.where);
      const source = requestedIds.length
        ? MATCHED.filter(k => requestedIds.indexOf(k.id) !== -1)
        : BASELINE;
      const size = vars.page?.size ?? PAGE_SIZE;
      const pageIndex = vars.page?.page ?? 0;
      const slice = source.slice(pageIndex * size, pageIndex * size + size);
      return fulfill(route, {
        kitsConnection: {
          totalElements: source.length,
          number: pageIndex,
          content: slice.map(k => kitRow(k.id, k.status)),
        },
      });
    }

    if (raw.includes('findAutocompleteDeviceRequests')) {
      return fulfill(route, { deviceRequestConnection: { content: [] } });
    }
    if (raw.includes('findAutocompleteDonors')) {
      return fulfill(route, { donorsConnection: { content: [] } });
    }
    if (raw.includes('findAutocompleteDonorParents')) {
      return fulfill(route, { donorParentsConnection: { content: [] } });
    }
    if (raw.includes('findAutocompleteLotIds')) {
      return fulfill(route, { kitsConnection: { content: [] } });
    }
    if (raw.includes('findUsers')) {
      return fulfill(route, { deviceRequests: [], donorParents: [] });
    }

    return fulfill(route, {});
  });
}

/** Digs the `id: { _in: [...] }` constraint out of the merged where-clause. */
function idsFromWhere(where: any): number[] {
  if (!where) return [];
  if (where.id && Array.isArray(where.id._in)) return where.id._in.map(Number);
  if (Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      const found = idsFromWhere(clause);
      if (found.length) return found;
    }
  }
  return [];
}

test.describe('kit-index pasted ID list + bulk update safeguards @mocked', () => {
  test('filters by pasted IDs, reports the misses, and guards the bulk update', async ({ page }) => {
    test.setTimeout(90_000);

    const recorded: Recorded = { findAllKits: [], lookup: [] };
    await authenticateWithPermissions(page, ['app:bulkedit', 'read:kits', 'write:kits']);
    await stubGraphql(page, recorded);

    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr').first()).toBeVisible({ timeout: 30_000 });

    // ── 1. pasting an ID list switches the search box into ID-list mode ──────
    const idListQuery = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllKits')
        && idsFromWhere(JSON.parse(r.request().postData() ?? '{}').variables?.where).length > 0,
      { timeout: 20_000 },
    );
    // Deliberately messy input: whitespace, a CTA- prefix, and a duplicate.
    const pasted = REQUESTED_IDS.map((id, i) => (i === 1 ? ` CTA-${id} ` : `${id}`)).join(',')
      + `,${REQUESTED_IDS[0]}`;
    await page.locator('#kit-index_wrapper .dt-search input').fill(pasted);
    await idListQuery;

    const idListVars = recorded.findAllKits.filter(v => idsFromWhere(v.where).length > 0).pop();
    expect(idListVars.term, 'ID-list mode must not also send a free-text term').toBe('');
    expect(idsFromWhere(idListVars.where), 'duplicates and the CTA- prefix must normalise away')
      .toEqual(REQUESTED_IDS);

    // The banner makes the mode change visible and states the shortfall.
    await expect(page.locator('[data-testid="id-list-banner"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="id-list-matched-count"]')).toHaveText('12');
    await expect(page.locator('[data-testid="id-list-requested-count"]')).toHaveText('14');

    // Only the matched devices are listed, one page's worth at a time.
    await expect(page.locator('#kit-index tbody tr')).toHaveCount(PAGE_SIZE);
    await expect(page.locator('#kit-index tbody tr', { hasText: 'Latitude 1001' })).toBeVisible();
    await expect(page.locator('#kit-index tbody tr', { hasText: 'Latitude 1013' })).toHaveCount(0);

    // ── 2. unmatched IDs are named, with the archived default called out ─────
    const missing = page.locator('[data-testid="id-list-missing"]');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('2');
    await expect(missing).toContainText('14');
    await expect(missing, 'the archived exclusion is the main footgun and must be spelled out')
      .toContainText('Archived Devices');
    await expect(page.locator('[data-testid="id-list-missing-ids"]'))
      .toHaveText(MISSING_IDS.join(', '));

    // ── 3. "select all N matched" reaches devices on later pages ─────────────
    // The switch's own <input> sits under its label — click the label, as a user would.
    await page.locator('label[for="bulkToggle"]').click();
    await expect(page.locator('#bulkToggle')).toBeChecked();
    const selectAll = page.locator('[data-testid="id-list-select-all"]');
    await expect(selectAll).toBeVisible();
    await expect(selectAll).toContainText('12');
    await selectAll.click();

    const bulkButton = page.locator('label .btn-warning', { hasText: 'Bulk Update' });
    await expect(bulkButton.locator('.badge')).toHaveText('12', { timeout: 10_000 });
    // 12 selected while only 10 rows are on screen — the other 2 were never visited.
    await expect(page.locator('#kit-index tbody tr')).toHaveCount(PAGE_SIZE);

    // Toastr sits top-right over the card header; clear it before clicking through.
    await page.evaluate(() => document.querySelector('#toast-container')?.remove());

    // ── 4. the modal warns that the selection spans two statuses ─────────────
    await bulkButton.click();
    const warning = page.locator('[data-testid="bulk-mixed-status"]');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning.locator('li')).toHaveCount(2);
    await expect(warning.locator('li').nth(0)).toContainText('10');
    await expect(warning.locator('li').nth(0)).toContainText('Assessment check completed');
    await expect(warning.locator('li').nth(1)).toContainText('2');
    await expect(warning.locator('li').nth(1)).toContainText('Device received into CTA');
    // Advisory only — the update button stays reachable behind the normal form validity gate.
    await expect(page.locator('.modal-footer .btn-warning', { hasText: 'UPDATE' })).toBeVisible();
  });

  test('a term that is not a valid ID list falls back to a normal text search @mocked', async ({ page }) => {
    test.setTimeout(60_000);

    const recorded: Recorded = { findAllKits: [], lookup: [] };
    await authenticateWithPermissions(page, ['app:bulkedit']);
    await stubGraphql(page, recorded);

    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr').first()).toBeVisible({ timeout: 30_000 });

    const textQuery = page.waitForResponse(
      r => r.url().includes('/graphql')
        && (r.request().postData() ?? '').includes('findAllKits')
        && (JSON.parse(r.request().postData() ?? '{}').variables?.term ?? '').includes('ThinkPad'),
      { timeout: 20_000 },
    );
    await page.locator('#kit-index_wrapper .dt-search input').fill('1001, ThinkPad');
    await textQuery;

    // No ID-list mode: no banner, no id constraint, and the raw term goes through.
    await expect(page.locator('[data-testid="id-list-banner"]')).toHaveCount(0);
    const last = recorded.findAllKits[recorded.findAllKits.length - 1];
    expect(idsFromWhere(last.where)).toEqual([]);
    // The user is told why, naming the token that could not be read as an ID.
    await expect(page.locator('#toast-container')).toContainText('ThinkPad', { timeout: 10_000 });
  });
});
