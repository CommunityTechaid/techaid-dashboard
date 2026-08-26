/**
 * Mocked coverage for the streamlined postcode-first location step (#178):
 * postcode-location-step.component.ts + ward-lookup.service.ts, gated by the
 * `streamlined-ward-lookup` flag.
 *
 * The component's own contract (see its header comment) is: the lookup table holds only the
 * three supported boroughs, so a resolved-but-unsupported postcode and a genuinely absent one
 * both land in 'not-found' -> 'out-of-area', and the copy must never name a borough on that
 * path. A well-formed-but-unknown postcode ('malformed') and a failed table fetch
 * ('unavailable') are two further, distinct dead ends — none of the four states may bleed into
 * another. This spec pins all four, plus the borough-scoped device narrowing (served by
 * boroughAvailabilityPublic, see BoroughAvailabilityService) and the legacy iframe fallback when
 * the flag is off.
 *
 * Real postcodes, verified against the shipped table (src/assets/ward-lookup/postcode-index.may-2026.json):
 *   - SE15 5TD -> Peckham ward, Southwark (covered)
 *   - E14 8JH  -> Canary Wharf ward, Tower Hamlets (covered only with the borough flag on)
 *   - SE13 6TQ -> outward code SE13 is entirely absent from the table (Lewisham)
 *
 * @mocked — all GraphQL stubbed, no token needed; runs in CI's e2e-mocked gate.
 */
import { test, expect, Page } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark
const OUT_OF_AREA_POSTCODE = 'SE13 6TQ'; // Lewisham — absent from the table
const TOWER_HAMLETS_POSTCODE = 'E14 8JH'; // Canary Wharf, Tower Hamlets
const MALFORMED_POSTCODE = 'NOT A POSTCODE';

interface FlagState {
  towerHamlets: boolean;
  streamlinedLookup: boolean;
}

/** Stubs everything the page needs to reach its ready state, at the given flag values. */
async function installMocks(page: Page, flags: FlagState): Promise<void> {
  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );

  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
  );

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (raw.includes('buildInfo')) {
      // BackendStatusService polls this via a raw fetch(), independent of Apollo. Left
      // unanswered it keeps retrying and, after ~1s, AppComponent's global interstitial
      // swaps out the router-outlet (destroying OrgRequestComponent mid-flow) even though
      // the page's own local ready state was already reached.
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({
        data: {
          featureFlagsPublic: [
            { key: 'tower-hamlets-borough-support', enabled: flags.towerHamlets },
            { key: 'streamlined-ward-lookup', enabled: flags.streamlinedLookup },
          ],
        },
      });
    }
    if (raw.includes('boroughAvailabilityPublic')) {
      // Borough-scoped availability is server config since #179 — it used to be a hardcoded
      // constant in the bundle, so this stub is what makes the narrowing testable at all. The
      // shape mirrors the seeded configuration: Lambeth and Southwark offer everything, Tower
      // Hamlets is the laptops-only pilot.
      const everything = [
        'laptops',
        'desktops',
        'tablets',
        'phones',
        'allInOnes',
        'commsDevices',
        'broadbandHubs',
        'other',
      ];
      return json({
        data: {
          boroughAvailabilityPublic: [
            { borough: 'Lambeth', offered: everything, maxPerReferee: 3, unresolvedAuto: [] },
            { borough: 'Southwark', offered: everything, maxPerReferee: 3, unresolvedAuto: [] },
            { borough: 'Tower Hamlets', offered: ['laptops'], maxPerReferee: 1, unresolvedAuto: [] },
          ],
        },
      });
    }
    if (raw.includes('adminConfig')) {
      return json({
        data: {
          adminConfig: {
            canPublicRequestSIMCard: true,
            canPublicRequestLaptop: true,
            canPublicRequestPhone: true,
            canPublicRequestBroadbandHub: true,
            canPublicRequestTablet: true,
            canPublicRequestDesktop: true,
          },
        },
      });
    }
    if (raw.includes('findContent')) {
      return json({ data: { post: { id: '1', content: '<p>E2E public request page content</p>' } } });
    }
    if (raw.includes('findAutocompleteReferringOrgs')) {
      // A single match, so the org step resolves straight to the contact lookup rather than
      // the "not listed" dead end.
      return json({ data: { referringOrganisationsPublic: [{ id: 'org-1', name: 'E2E Test Org' }] } });
    }
    if (raw.includes('findOrganisationContact')) {
      // A single match takes getRefContact() straight to showRequestPage(), skipping the
      // "register as a new contact" branch.
      return json({ data: { referringOrganisationContactsPublic: [{ id: 'contact-1', fullName: 'E2E Contact' }] } });
    }
    return json({ data: {} });
  });
}

/**
 * Drives the org-search and contact-lookup steps that sit between a confirmed location and the
 * device-request page (requestPage.hideExpression only flips via showRequestPage(), which is
 * reached from here) — see org-request.ts.
 */
async function advanceToDeviceRequestPage(page: Page): Promise<void> {
  const orgSelectInput = page.locator('form-choice ng-select input');
  await expect(orgSelectInput).toBeVisible({ timeout: 15_000 });
  await orgSelectInput.fill('E2E');
  const orgOption = page.locator('.ng-option', { hasText: 'E2E Test Org' });
  await expect(orgOption).toBeVisible({ timeout: 15_000 });
  await orgOption.click();

  await page.getByPlaceholder('Your email address').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Find Email' }).click();

  await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });
}

/** Loads the public form and waits for it to reach its ready state. */
async function openReadyPage(page: Page): Promise<void> {
  await page.goto('/organisation-device-request');
  await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
}

async function checkPostcode(page: Page, postcode: string): Promise<void> {
  await expect(page.locator('#postcode')).toBeVisible({ timeout: 15_000 });
  await page.locator('#postcode').fill(postcode);
  await page.getByRole('button', { name: 'Check' }).click();
}

/**
 * Drives a Tower Hamlets postcode through to a submittable device-request form, so the two
 * request-limit tests below differ only in the mocked createDeviceRequest error.
 */
async function fillSubmittableTowerHamletsRequest(page: Page): Promise<void> {
  await checkPostcode(page, TOWER_HAMLETS_POSTCODE);
  await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit a request' }).click();

  // Precondition: the note is showing before the limit is hit.
  await expect(page.getByTestId('device-availability-note')).toBeVisible({ timeout: 15_000 });

  await advanceToDeviceRequestPage(page);

  const form = page.locator('formly-form');
  await form.getByText('Laptop', { exact: true }).click();
  await form.locator('textarea').fill('E2E test request — no identifiable details.');
  await page
    .getByLabel("For your records, enter your client's initials or a client reference")
    .fill('E2E-1');
}

/**
 * Registered AFTER installMocks on purpose: Playwright matches routes in reverse registration
 * order, so this wins for createDeviceRequest and everything else falls back to the general mock.
 */
async function mockCreateDeviceRequestError(page: Page, message: string): Promise<void> {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('createDeviceRequest')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errors: [{ message }] }),
      });
    }
    return route.fallback();
  });
}

test.describe('streamlined ward lookup @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('covered postcode advances to the request form', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await checkPostcode(page, COVERED_POSTCODE);

    const covered = page.getByTestId('postcode-covered');
    await expect(covered).toBeVisible({ timeout: 15_000 });
    await expect(covered).toContainText('Peckham');
    await expect(covered).toContainText('Southwark');

    await page.getByRole('button', { name: 'Submit a request' }).click();

    // The postcode step is gone, and the device-request form has taken its place.
    await expect(page.locator('#postcode')).toHaveCount(0);
    await expect(page.locator('formly-form')).toBeVisible({ timeout: 15_000 });
  });

  test('out-of-area postcode blocks progress and names nothing', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await checkPostcode(page, OUT_OF_AREA_POSTCODE);

    const outOfArea = page.getByTestId('postcode-out-of-area');
    await expect(outOfArea).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('formly-form')).toHaveCount(0);

    // The agreed wording, pinned. Signed off in the Request Booking 2.0 tracker: an unsupported
    // postcode gets one plain apology and one route to a human, and the address to write to is
    // part of the promise — a card that regrets and then offers nowhere to go is worse than the
    // borough list it replaced.
    await expect(outOfArea).toContainText(
      "Unfortunately we don't support this area at the moment. Please email us for further information.",
    );
    await expect(outOfArea.locator('a[href^="mailto:distributions@communitytechaid.org.uk"]')).toBeVisible();

    // The table holds only the boroughs we serve, so a miss tells us nothing about where the
    // postcode actually is — the card must never name a resolved area on this path.
    const text = (await outOfArea.textContent()) ?? '';
    expect(text.toLowerCase()).not.toContain('lewisham');
    expect(text.toLowerCase()).not.toContain('ward');
  });

  /**
   * The Open Government Licence acknowledgements are required to be shown, so they cannot be
   * dropped — but at .small they read as page copy and crowded the postcode result, which is what
   * the tracker asked to fix. This pins both halves: still rendered, and visibly smaller than the
   * body text around it.
   */
  test('the licence attribution is rendered, and smaller than body copy', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    const attribution = page.getByTestId('postcode-attribution');
    await expect(attribution).toBeVisible({ timeout: 15_000 });
    await expect(attribution).toContainText('Crown copyright');

    const sizes = await attribution.evaluate((element) => ({
      attribution: parseFloat(getComputedStyle(element).fontSize),
      body: parseFloat(getComputedStyle(document.body).fontSize),
    }));
    expect(sizes.attribution).toBeLessThan(sizes.body * 0.8);
  });

  test('malformed postcode gets a distinct message from out-of-area', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await checkPostcode(page, MALFORMED_POSTCODE);

    await expect(page.getByTestId('postcode-malformed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('postcode-out-of-area')).toHaveCount(0);
  });

  test('a failed table fetch is reported as unavailable, not out-of-area', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await page.route('**/assets/ward-lookup/*.json', route => route.abort());
    await openReadyPage(page);

    await checkPostcode(page, COVERED_POSTCODE);

    await expect(page.getByTestId('postcode-unavailable')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('postcode-out-of-area')).toHaveCount(0);
  });

  test('borough-scoped device filtering narrows Tower Hamlets to laptops', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await checkPostcode(page, TOWER_HAMLETS_POSTCODE);
    await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Submit a request' }).click();

    const note = page.getByTestId('device-availability-note');
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText('Tower Hamlets');
    await expect(note).toContainText('laptops');

    await advanceToDeviceRequestPage(page);

    const form = page.locator('formly-form');
    await expect(form.getByText('Laptop', { exact: true })).toBeVisible();
    await expect(form.getByText('Smartphone', { exact: true })).toHaveCount(0);
    await expect(form.getByText('Tablet', { exact: true })).toHaveCount(0);
    await expect(form.getByText('Desktop computer', { exact: true })).toHaveCount(0);
  });

  /**
   * Red/green for the amber-note bug: showMoreThanThreeRequestsPage() swaps the form's field
   * groups for the "Oops!" limit page, but the amber device-availability note sits outside
   * those field groups, above them — so it used to stay on screen telling someone what they
   * could request on the very page refusing them. Fixed by gating the note on
   * `!requestLimitReached`.
   *
   * The mocked error uses the REAL server format (techaid-server DeviceRequestMutations.kt):
   * "Could not create new requests. This user already has ${open} requests open in ${scope}
   * (limit ${limit})". This also pins the second fix on the same page: the copy used to
   * hardcode "3 open requests", which was wrong for every borough group whose limit isn't 3 —
   * since #179 the cap is per-group and per-organisation, so a Tower Hamlets referrer (limit 1)
   * was told they already had three requests when they had one.
   */
  test('the request-limit page clears the amber note and shows the real limit figures', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await fillSubmittableTowerHamletsRequest(page);
    await mockCreateDeviceRequestError(
      page,
      'Could not create new requests. This user already has 1 requests open in Tower Hamlets (limit 1)',
    );

    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByText('Oops!')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('1 open request for Tower Hamlets')).toBeVisible();
    await expect(page.getByText('The limit is 1.')).toBeVisible();
    await expect(page.getByText('3 open requests')).toHaveCount(0);

    // This is the assertion that fails without the fix: the note used to remain visible above
    // the limit page.
    await expect(page.getByTestId('device-availability-note')).toHaveCount(0);
  });

  /**
   * Pins the fail-closed fallback: the marker string alone is what classifies an error as a
   * limit refusal, but if the trailing wording doesn't match the parser's shape the page must
   * degrade to vague copy naming no number — never carry over a wrong one. A refusal screen
   * stating a false count is worse than one stating none.
   */
  test('an unparseable limit error falls back to copy that states no number', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });
    await openReadyPage(page);

    await fillSubmittableTowerHamletsRequest(page);
    await mockCreateDeviceRequestError(
      page,
      'Could not create new requests. This user already has too many open.',
    );

    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByText('Oops!')).toBeVisible({ timeout: 15_000 });

    const limitParagraph = page.getByText('the maximum number of open requests for this area');
    await expect(limitParagraph).toBeVisible();

    const text = (await limitParagraph.textContent()) ?? '';
    expect(text).not.toMatch(/\d/);
  });

  test('Tower Hamlets is out of area when its borough flag is off', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: false, streamlinedLookup: true });
    await openReadyPage(page);

    await checkPostcode(page, TOWER_HAMLETS_POSTCODE);

    // The postcode resolves fine — it is the borough that is not currently accepted.
    await expect(page.getByTestId('postcode-out-of-area')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('postcode-covered')).toHaveCount(0);
  });

  test('legacy iframe path still renders when the flag is off', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: false, streamlinedLookup: false });
    await openReadyPage(page);

    const iframe = page.locator('iframe[src^="https://communitytechaid.github.io/ward_lookup.html"]');
    await expect(iframe).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('postcode-location-step')).toHaveCount(0);
    await expect(page.locator('#postcode')).toHaveCount(0);
  });
});
