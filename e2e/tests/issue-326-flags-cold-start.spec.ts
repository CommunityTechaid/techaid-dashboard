/**
 * A feature-flags request that fails while the API is cold-starting must not decide the flags
 * for the rest of the page load (#326).
 *
 * The header asks for the flags as soon as the app boots, before the request form's own
 * cold-start check. FeatureFlagService used to cache whatever that first request produced,
 * including the "every flag off" fallback for a failure or timeout, so when the form asked
 * later (backend now awake) it was handed the stale all-off answer and told a Tower Hamlets
 * referrer their postcode was out of area. A reload fixed it.
 *
 * Here the first flags request fails (as a cold API does) and every later one succeeds with
 * Tower Hamlets on: the postcode must be accepted without a reload.
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { test, expect } from '../helpers/csp';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const TOWER_HAMLETS_POSTCODE = 'E14 8JH'; // Canary Wharf, Tower Hamlets

test.describe('flags survive a cold-start failure @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a failed first flags request is retried, so Tower Hamlets is still accepted', async ({ page }) => {
    test.setTimeout(90_000);
    let flagRequests = 0;

    await page.route(AUTH0_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
    );
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      const json = (body: unknown) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

      if (raw.includes('featureFlagsPublic')) {
        flagRequests++;
        if (flagRequests === 1) {
          // What the gateway answers while the API is still scaled to zero.
          return route.fulfill({ status: 503, contentType: 'text/plain', body: 'upstream starting' });
        }
        return json({ data: { featureFlagsPublic: [{ key: 'tower-hamlets-borough-support', enabled: true }] } });
      }
      if (raw.includes('buildInfo')) {
        return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
      }
      if (raw.includes('adminConfig')) {
        return json({
          data: {
            adminConfig: {
              canPublicRequestSIMCard: true, canPublicRequestLaptop: true, canPublicRequestPhone: true,
              canPublicRequestBroadbandHub: true, canPublicRequestTablet: true, canPublicRequestDesktop: true,
            },
          },
        });
      }
      if (raw.includes('findContent')) {
        return json({ data: { post: { id: '1', content: '<p>E2E public request page content</p>' } } });
      }
      return json({ data: {} });
    });

    await page.goto('/organisation-device-request');
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

    await page.locator('#postcode').fill(TOWER_HAMLETS_POSTCODE);
    await page.getByRole('button', { name: 'Check' }).click();

    await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('postcode-out-of-area')).toHaveCount(0);
    expect(flagRequests).toBeGreaterThan(1);
  });
});
