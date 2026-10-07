/**
 * The public out-of-area card must never name a borough, whatever the borough flag says (#177).
 *
 * `tower-hamlets-borough-support` can be flipped back and forth from the Admin Panel with no
 * deploy. Before #177 the borough names were written into Formly templates by hand, so the
 * flag could be toggled all day and the page would keep naming Lambeth and Southwark. The
 * postcode step's out-of-area card now apologises and names no borough, so there is nothing
 * left for the flag to move — this spec pins that, in both flag states, so a hardcoded list
 * cannot creep back in.
 *
 * The legacy github.io iframe path (and the `streamlined-ward-lookup` flag that selected it)
 * was retired on 2026-10-07; its flag-off permutations no longer exist.
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { test, expect, Page } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';

interface FlagState {
  towerHamlets: boolean;
}

async function installMocks(page: Page, flags: FlagState): Promise<void> {
  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
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

test.describe('out-of-area copy follows the borough flags @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const towerHamlets of [false, true]) {
    test(`the postcode step apologises and names no borough (towerHamlets=${towerHamlets})`, async ({ page }) => {
      test.setTimeout(90_000);
      await installMocks(page, { towerHamlets });
      await page.goto('/organisation-device-request');
      await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

      await page.locator('#postcode').fill('SE13 6TQ'); // Lewisham — absent from the table
      await page.getByRole('button', { name: 'Check' }).click();

      const card = page.getByTestId('postcode-out-of-area');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(
        "Unfortunately we don't support this area at the moment. Please email us for further information.",
      );

      // No borough may be named on this path, in either flag state. A hand-written list would read correctly
      // here today and go stale the moment the flag moved, which is the #177 failure exactly.
      const text = ((await card.textContent()) ?? '').toLowerCase();
      for (const borough of ['lambeth', 'southwark', 'tower hamlets', 'lewisham']) {
        expect(text).not.toContain(borough);
      }
    });
  }
});
