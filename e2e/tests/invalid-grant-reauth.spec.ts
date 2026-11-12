/**
 * Staff whose refresh token is dead (expired / rotated away) must be sent to Auth0 login once,
 * promptly — not left on a half-working page — while the public request form must be untouched.
 *
 * Mechanism (auth0-spa-js 2.27, Auth0Client._getTokenUsingRefreshToken -> http.getJSON): the
 * refresh grant answers 403 {"error":"invalid_grant"}; getJSON throws
 * GenericError('invalid_grant'). `useRefreshTokensFallback` is off, so there is no iframe
 * `login_required` fallback, and the dead refresh token stays in the cache. The ID-token entry
 * does not expire, so isAuthenticated$ keeps emitting true. Before the fix `invalid_grant` was
 * not a re-auth code: the auth link retried the exchange three times, failed the GraphQL
 * operation and never redirected, leaving the user on a page with no data until they re-logged
 * in by hand.
 *
 * Design pinned here:
 *   - `invalid_grant` gets ONE retry (the rotation-race recovery that
 *     auth-link-no-anonymous-downgrade.spec.ts pins), then redirects to login.
 *   - On a public route the same dead session sends the request tokenless, exactly like an
 *     anonymous visitor, and never redirects (the 2026-07-28 incident class).
 *
 * @mocked — Auth0 and GraphQL stubbed, no token needed.
 */
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const TOKEN_ENDPOINT = '**://techaid-auth.eu.auth0.com/oauth/token';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

const BUILD_INFO = { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' };

test.describe('dead refresh token (invalid_grant) @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('staff page redirects to Auth0 login once instead of failing silently', async ({ page }) => {
    test.setTimeout(90_000);

    let authorizeHits = 0;
    await page.route(AUTH0_ORIGIN, route => {
      if (route.request().url().includes('/authorize')) {
        authorizeHits++;
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      });
    });

    let tokenCalls = 0;
    await page.route(TOKEN_ENDPOINT, route => {
      tokenCalls++;
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' }),
      });
    });

    let graphqlAttempts = 0;
    await page.route('**/graphql', route => {
      const raw = route.request().postData() ?? '';
      if (!raw.includes('buildInfo') && !raw.includes('FeatureFlagsPublic')) {
        graphqlAttempts++;
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { buildInfo: BUILD_INFO, kits: [], donors: [], typeCount: [], statusCount: [], volunteerCount: [] },
        }),
      });
    });

    await loginWith(page, ['read:kits'], { expiredAccessToken: true, refreshToken: true });
    await page.goto('/dashboard');

    await page.waitForURL(/auth0\.com\/authorize/, { timeout: 30_000 });
    // Let any duplicate redirect or extra token calls land before judging.
    await page.waitForTimeout(2_000);

    expect(authorizeHits, 'exactly one redirect to /authorize').toBe(1);
    // The auth link now makes 2 exchanges per operation (attempt + the single rotation-race
    // retry) instead of 3. The page also makes token calls the link does not own (SDK init
    // checkSession, the user-state load), so the measured total is 6 before the fix and 5 after;
    // the redirect assertion above is the real discriminator, this just bounds the retries.
    expect(tokenCalls, 'refresh exchanges for a dead token').toBeLessThanOrEqual(5);
    // The redirect was decided inside the auth link, i.e. we were inside the guarded page.
    expect(graphqlAttempts, 'no Apollo operation was sent downgraded').toBe(0);
  });

  test('public request form with the same dead session still loads and never redirects', async ({ page }) => {
    test.setTimeout(90_000);

    let authorizeHits = 0;
    await page.route(AUTH0_ORIGIN, route => {
      if (route.request().url().includes('/authorize')) {
        authorizeHits++;
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      });
    });
    await page.route(TOKEN_ENDPOINT, route =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' }),
      }),
    );
    await page.route(WARD_LOOKUP_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
    );

    const operations: string[] = [];
    await page.route('**/graphql', route => {
      const raw = route.request().postData() ?? '';
      let operationName = '';
      try {
        operationName = JSON.parse(raw).operationName ?? '';
      } catch {
        /* not ours */
      }
      if (raw.includes('adminConfig')) {
        operations.push('adminConfig');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              buildInfo: BUILD_INFO,
              adminConfig: {
                canPublicRequestSIMCard: true,
                canPublicRequestLaptop: true,
                canPublicRequestPhone: true,
                canPublicRequestBroadbandHub: true,
                canPublicRequestTablet: true,
                canPublicRequestDesktop: true,
              },
            },
          }),
        });
      }
      operations.push(operationName);
      const data =
        operationName === 'findContent'
          ? { buildInfo: BUILD_INFO, post: { id: '1', content: '<p>E2E public request page content</p>' } }
          : operationName === 'findAutocompleteReferringOrgs'
            ? { buildInfo: BUILD_INFO, referringOrganisationsPublic: [] }
            : { buildInfo: BUILD_INFO };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    });

    await loginWith(page, ['read:kits'], { expiredAccessToken: true, refreshToken: true });
    await page.goto('/organisation-device-request');

    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);

    await expect(page).toHaveURL(/organisation-device-request/);
    expect(authorizeHits, 'a public page must never bounce to Auth0').toBe(0);
    expect(operations).toContain('adminConfig');
  });
});
