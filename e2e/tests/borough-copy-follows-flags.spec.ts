/**
 * The public out-of-area copy must follow the borough flags, in both directions (#177).
 *
 * The point of `streamlined-ward-lookup` and `tower-hamlets-borough-support` is that they
 * can be flipped back and forth from the Admin Panel with no deploy. That promise is only
 * real if everything downstream of them actually moves — including this sentence, which is
 * the one thing an out-of-area referrer reads. Before #177 the borough names were written
 * into three Formly templates by hand, so the flags could be toggled all day and the page
 * would keep naming Lambeth and Southwark.
 *
 * Rewriting a Formly `template` in place only works because `lazyRender` is on (the
 * default): the hidden field's container is cleared, and unhiding builds a fresh component
 * that reads the current template. If someone sets `lazyRender: false` in the Formly config,
 * the page renders once at load and this spec is what fails.
 *
 * The middle case is the load-bearing one. Tower Hamlets needs BOTH flags: the legacy ward
 * lookup is served from communitytechaid.github.io with its own Lambeth/Southwark boundary
 * data and cannot resolve a Tower Hamlets postcode however the borough flag is set. So
 * borough-on + lookup-off must still say Lambeth or Southwark. Promising a borough we will
 * then reject is worse than not offering it.
 *
 * Since #178 the three cases no longer read the same element. The first two run the legacy
 * iframe path and read the Formly out-of-area page; the third selects the streamlined postcode
 * step, which owns its own out-of-area card and never renders the iframe at all.
 *
 * The third case no longer asserts the same sentence, and that is a deliberate narrowing rather
 * than drift. The Request Booking 2.0 round replaced the streamlined card's copy with a plain
 * apology and an email address, naming no boroughs at all — so on that path there is nothing
 * left for the flags to move. What the third case now pins is the other half of the #177
 * promise: whatever the flags say, that card must never name a borough, because a card that
 * lists boroughs it does not read from the flags is exactly the hardcoded copy #177 removed.
 * The flag-following assertion itself lives on in the two legacy-path cases, which still show
 * the Formly page.
 *
 * @mocked — all GraphQL stubbed and the ward-lookup iframe served locally, so no token is
 * needed and nothing leaves the machine.
 */
import { test, expect, Page } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

/**
 * Stands in for the real ward lookup: posts the "out of area" result the iframe sends when
 * a postcode falls outside its boundary data. Playwright fulfils this at the real URL, so
 * the message still arrives with the github.io origin the component checks for.
 */
const WARD_LOOKUP_STUB = `<html><body><script>
  setTimeout(function () {
    window.parent.postMessage({ ward: 'unsupported', borough: 'unsupported' }, '*');
  }, 300);
</script></body></html>`;

interface FlagState {
  towerHamlets: boolean;
  streamlinedLookup: boolean;
}

async function installMocks(page: Page, flags: FlagState): Promise<void> {
  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );

  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: WARD_LOOKUP_STUB }),
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
    return json({ data: {} });
  });
}

/** Loads the public form and drives it to the out-of-area state via the stubbed iframe. */
async function openOutOfAreaPage(page: Page): Promise<void> {
  await page.goto('/organisation-device-request');
  // adminConfig resolving flips the page to its ready state, which is what renders the
  // iframe; the stub then posts its message.
  await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Oops! Unfortunately')).toBeVisible({ timeout: 30_000 });
}

test.describe('out-of-area copy follows the borough flags @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('both flags off: names the two original boroughs', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: false, streamlinedLookup: false });
    await openOutOfAreaPage(page);

    // Today's exact wording. The default must be a no-op, or shipping the flags changes
    // public copy before anyone decides to.
    await expect(page.getByText('who live in Lambeth or Southwark')).toBeVisible();
    await expect(page.getByText('falls within Lambeth or Southwark')).toBeVisible();
    await expect(page.getByText('Tower Hamlets')).toHaveCount(0);
  });

  test('borough flag on but legacy lookup selected: still the two original boroughs', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: false });
    await openOutOfAreaPage(page);

    // The accepted gap, pinned. The legacy lookup cannot resolve a Tower Hamlets postcode,
    // so naming the borough here would advertise something the very next step rejects.
    await expect(page.getByText('who live in Lambeth or Southwark')).toBeVisible();
    await expect(page.getByText('Tower Hamlets')).toHaveCount(0);
  });

  test('both flags on: the streamlined card apologises and names no borough', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, { towerHamlets: true, streamlinedLookup: true });

    // Different route to the same state. With the streamlined lookup selected the iframe is
    // never rendered, so there is no postMessage to drive and no Formly out-of-area page —
    // #178 answers this case inside the postcode step instead.
    await page.goto('/organisation-device-request');
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

    await page.locator('#postcode').fill('SE13 6TQ'); // Lewisham — absent from the table
    await page.getByRole('button', { name: 'Check' }).click();

    const card = page.getByTestId('postcode-out-of-area');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(
      "Unfortunately we don't support this area at the moment. Please email us for further information.",
    );

    // No borough may be named on this path, with both flags ON — the case that would catch a
    // hardcoded list being reintroduced. A hand-written list would read correctly here today and
    // go stale the moment a flag moved, which is the #177 failure exactly.
    const text = ((await card.textContent()) ?? '').toLowerCase();
    for (const borough of ['lambeth', 'southwark', 'tower hamlets', 'lewisham']) {
      expect(text).not.toContain(borough);
    }
  });
});
