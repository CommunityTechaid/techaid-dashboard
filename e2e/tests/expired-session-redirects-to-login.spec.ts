/**
 * Regression pin for the OTHER half of the graphql.module.ts auth link — the half added by
 * PR #78 ("redirect to login on expired session instead of Access Denied popup") and, until
 * this spec, never covered by anything.
 *
 * Why it needs its own spec: anon-public-request-no-login-redirect.spec.ts pins that an
 * anonymous visitor is NOT bounced, but it passes just as happily if redirectToLogin() is
 * deleted outright — verified 2026-07-28 by removing the call and watching the whole @mocked
 * suite stay green (54/54). That is precisely how PR #78 shipped an untested behaviour change
 * that sat unnoticed until the 2026-07-28 production incident. The two specs together pin the
 * `authService.loggedIn` gate from both sides:
 *
 *   anonymous visitor          -> loggedIn false -> no redirect  (anon-public-request spec)
 *   staff session expired mid-use -> loggedIn true  -> redirect     (this spec)
 *
 * Mechanism. loginWith(..., { expiredAccessToken: true }) seeds a stale
 * session: the @@user@@ identity entry stays valid, so isAuthenticated$ emits true, so
 * AuthenticationService.loggedIn is true and AuthGuard activates the route — but the
 * access-token entries are expired and carry no refresh_token, so the next
 * getAccessTokenSilently() rejects locally with `missing_refresh_token` (one of
 * REAUTH_ERROR_CODES). That is the real shape of a session dying under a logged-in user.
 *
 * Route choice is load-bearing. /dashboard is guarded AND DashboardIndexComponent holds its
 * findAll until isAuthenticated$ emits true (PR #153), which removes the ordering race this
 * test would otherwise have: the query cannot fire before loggedIn is set.
 *
 * Discriminator. A redirect to Auth0 could in principle come from AuthGuard rather than the
 * auth link, which would make this spec pass for the wrong reason. It cannot here: identity is
 * cached, so AuthGuard lets the route through. Since #164 the auth link fails the request after
 * redirecting instead of sending it untokened, so no Apollo request reaches /graphql at all; the
 * test asserts exactly that (no Apollo operation left without a token, the staff-area invariant).
 * An earlier version asserted that "a /graphql request was attempted", which the always-present
 * FeatureFlagsPublic HttpClient post satisfied on its own, so it proved nothing.
 *
 * The same stale session on a PUBLIC page is the opposite case (the later describe blocks). An
 * ex-staff browser still holds cached identity, so isAuthenticated$ is true and the auth link's
 * anonymous branch does not apply; before the fix every re-auth code below, and any HTTP 401,
 * sent that visitor to Auth0 from /organisation-device-request. Matched pair, per code:
 *
 *   staff area  (/dashboard)                    -> re-auth code / 401 -> redirect to login
 *   public page (/organisation-device-request)  -> re-auth code / 401 -> no redirect, page stays
 *
 * And for a 401 specifically (#391): on a public page the error link re-sends the operation once
 * without the token, so the form loads as it would for an anonymous visitor; in the staff area
 * nothing is ever re-sent tokenless (the last describe block).
 *
 * How each code is produced (auth0-spa-js, Auth0Client._getTokenUsingRefreshToken):
 *   - missing_refresh_token: expired access token and no refresh token in the cache; thrown
 *     locally, no network call.
 *   - login_required / consent_required: a refresh token is cached and the token endpoint answers
 *     {"error": "<code>"}; http.getJSON throws GenericError(<code>). useRefreshTokensFallback is
 *     off, so the SDK does not fall back to the iframe.
 *
 * @mocked — all GraphQL stubbed and the Auth0 tenant intercepted; no token needed, runs in
 * CI's e2e-mocked gate.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const TOKEN_ENDPOINT = '**://techaid-auth.eu.auth0.com/oauth/token';
// The public form's ready state embeds a ward-lookup iframe from this origin.
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

const BUILD_INFO = { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' };

const REAUTH_CODES = ['missing_refresh_token', 'login_required', 'consent_required'] as const;
type ReauthCode = (typeof REAUTH_CODES)[number];

/**
 * Seeds a logged-in session whose next getAccessTokenSilently() rejects with `code`, and counts
 * navigations to Auth0's /authorize (what loginWithRedirect() does). Route registration order
 * matters: Playwright matches in reverse, so the tenant catch-all goes first.
 */
async function seedDeadSession(page: Page, code: ReauthCode): Promise<{ authorizeHits: () => number }> {
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

  const viaTokenEndpoint = code !== 'missing_refresh_token';
  if (viaTokenEndpoint) {
    await page.route(TOKEN_ENDPOINT, route =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: code, error_description: `stubbed ${code}` }),
      }),
    );
  }

  await loginWith(page, ['read:kits'], { expiredAccessToken: true, refreshToken: viaTokenEndpoint });
  return { authorizeHits: () => authorizeHits };
}

interface PublicCall {
  operation: string;
  authenticated: boolean;
}

/**
 * Stubs /graphql for the public request form. `rejectTokens` answers every request that carries
 * an Authorization header with HTTP 401, the API's answer to a token it will not accept.
 */
async function stubPublicForm(page: Page, options: { rejectTokens?: boolean } = {}): Promise<PublicCall[]> {
  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
  );

  const calls: PublicCall[] = [];
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const authenticated = Boolean((await route.request().allHeaders())['authorization']);
    if (raw.includes('buildInfo')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { buildInfo: BUILD_INFO } }),
      });
    }
    let operation = '';
    try {
      operation = JSON.parse(raw).operationName ?? '';
    } catch {
      /* not ours */
    }
    // QUERY_ADMIN_CONFIG is unnamed; match on the body.
    if (!operation && raw.includes('adminConfig')) {
      operation = 'adminConfig';
    }
    calls.push({ operation, authenticated });

    if (options.rejectTokens && authenticated) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
    }
    const data =
      operation === 'adminConfig'
        ? {
            adminConfig: {
              canPublicRequestSIMCard: true,
              canPublicRequestLaptop: true,
              canPublicRequestPhone: true,
              canPublicRequestBroadbandHub: true,
              canPublicRequestTablet: true,
              canPublicRequestDesktop: true,
            },
          }
        : operation === 'findContent'
          ? { post: { id: '1', content: '<p>E2E public request page content</p>' } }
          : operation === 'findAutocompleteReferringOrgs'
            ? { referringOrganisationsPublic: [] }
            : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  return calls;
}

test.describe('expired staff session still re-prompts for login @mocked', () => {
  // Seed nothing from disk: the helper writes the whole synthetic session itself, so the
  // CI-minted token in e2e/.auth/user.json must not leak in and supply a *valid* token.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a logged-in user whose token cannot be renewed is sent to Auth0', async ({ page }) => {
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

    let tokenlessApollo = 0;
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      // The app's startup health probe (a raw `{ buildInfo }` fetch from BackendStatusService)
      // and FeatureFlagsPublic (HttpClient) bypass the Apollo auth link and are always tokenless.
      // Answer the probe; count only Apollo operations that went out without a token.
      if (!raw.includes('buildInfo') && !raw.includes('FeatureFlagsPublic')) {
        if (!(await route.request().allHeaders())['authorization']) {
          tokenlessApollo++;
        }
      }
      if (raw.includes('buildInfo')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { kits: [], donors: [], typeCount: [], statusCount: [], volunteerCount: [] },
        }),
      });
    });

    await loginWith(page, [], { expiredAccessToken: true });

    await page.goto('/dashboard');

    // The contract: the dying session is noticed and the user is sent to log in again.
    await page.waitForURL(/auth0\.com/, { timeout: 30_000 });

    // Let any downgraded request land before judging.
    await page.waitForTimeout(2_000);

    expect(authorizeHits).toBeGreaterThan(0);
    // The staff-area invariant: the failed token fetch failed the request; nothing was
    // downgraded to an anonymous request.
    expect(tokenlessApollo, 'Apollo operations sent without a token from a staff page').toBe(0);
  });

  // missing_refresh_token is the test above; these are the two codes that come back from the
  // token endpoint. Green before and after the public-page fix: guard rails against a fix that
  // stops redirecting staff, not reproductions.
  for (const code of ['login_required', 'consent_required'] as const) {
    test(`a logged-in user whose refresh answers ${code} is sent to Auth0 and sends nothing tokenless`, async ({ page }) => {
      test.setTimeout(90_000);

      const session = await seedDeadSession(page, code);

      let tokenlessApollo = 0;
      await page.route('**/graphql', async route => {
        const raw = route.request().postData() ?? '';
        // buildInfo (raw fetch) and FeatureFlagsPublic (HttpClient) bypass the Apollo auth link.
        if (!raw.includes('buildInfo') && !raw.includes('FeatureFlagsPublic')) {
          if (!(await route.request().allHeaders())['authorization']) {
            tokenlessApollo++;
          }
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { buildInfo: BUILD_INFO, kits: [], donors: [], typeCount: [], statusCount: [], volunteerCount: [] },
          }),
        });
      });

      await page.goto('/dashboard');

      await page.waitForURL(/auth0\.com\/authorize/, { timeout: 30_000 });
      await page.waitForTimeout(2_000);

      expect(session.authorizeHits(), 'exactly one redirect to /authorize').toBe(1);
      // The staff-area invariant: a failed token fetch fails the request, never downgrades it.
      expect(tokenlessApollo, 'Apollo operations sent without a token from a staff page').toBe(0);
    });
  }

  test('an HTTP 401 from the API on a staff page is sent to Auth0', async ({ page }) => {
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

    // A token the SDK still considers valid, which the API rejects (e.g. client clock skew past
    // the SDK's 60 s leeway). AuthGuard admits the route; the 401 is the only reason to redirect.
    await loginWith(page, ['read:kits']);

    let rejected = 0;
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      if (raw.includes('buildInfo')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { buildInfo: BUILD_INFO } }),
        });
      }
      if ((await route.request().allHeaders())['authorization']) {
        rejected++;
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
    });

    await page.goto('/dashboard');

    await page.waitForURL(/auth0\.com\/authorize/, { timeout: 30_000 });
    expect(authorizeHits).toBeGreaterThan(0);
    // The redirect came from the error link answering a 401, not from AuthGuard.
    expect(rejected).toBeGreaterThan(0);
  });
});

test.describe('a stale staff session never sends a public-page visitor to login @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Red before the fix: the auth link called redirectToLogin() for every re-auth code once
  // isAuthenticated$ was true, whatever the page, so the form never rendered.
  for (const code of REAUTH_CODES) {
    test(`public request form with a session that fails ${code} loads tokenless and never redirects`, async ({ page }) => {
      test.setTimeout(90_000);

      const session = await seedDeadSession(page, code);
      const calls = await stubPublicForm(page);

      await page.goto('/organisation-device-request');

      // adminConfig resolving is what renders the CMS body, so this proves the page's queries
      // went out and were answered rather than bounced.
      await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2_000);

      await expect(page).toHaveURL(/organisation-device-request/);
      expect(session.authorizeHits(), 'a public page must never bounce to Auth0').toBe(0);
      const adminConfig = calls.filter(call => call.operation === 'adminConfig');
      expect(adminConfig.length).toBeGreaterThan(0);
      // Treated as the anonymous visitor they now are.
      expect(adminConfig.every(call => !call.authenticated)).toBe(true);
    });
  }

  // Red before the fix: the error link redirected on any 401 with no staff-area check.
  test('an HTTP 401 on the public request form never redirects', async ({ page }) => {
    test.setTimeout(90_000);

    let auth0Hits = 0;
    await page.route(AUTH0_ORIGIN, route => {
      auth0Hits++;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      });
    });

    // A token the SDK still considers valid (so it is attached), which the API rejects.
    await loginWith(page, ['read:kits']);
    const calls = await stubPublicForm(page, { rejectTokens: true });

    await page.goto('/organisation-device-request');

    // Wait for the rejected adminConfig, then give any redirect time to fire.
    await expect
      .poll(() => calls.filter(call => call.operation === 'adminConfig' && call.authenticated).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3_000);

    await expect(page).toHaveURL(/organisation-device-request/);
    expect(auth0Hits, 'a public page must never bounce to Auth0').toBe(0);
  });

  // #391. Red before the fix: every adminConfig poll (every 4 s, up to 15 times) carried the
  // same rejected token, so the form sat on "Starting up" for about a minute and then showed its
  // retry message. The fix retries the rejected operation once, without the token.
  //
  // The "authenticated" flag below is read from the request the browser actually sent
  // (route.request().allHeaders()); nothing in this file injects an Authorization header, so a
  // tokenless call here really left the app without one.
  test('an HTTP 401 on the public request form is retried once without the token and the form renders', async ({ page }) => {
    test.setTimeout(90_000);

    let auth0Hits = 0;
    await page.route(AUTH0_ORIGIN, route => {
      auth0Hits++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0 login</body></html>' });
    });

    await loginWith(page, ['read:kits']);
    const calls = await stubPublicForm(page, { rejectTokens: true });

    await page.goto('/organisation-device-request');

    // Well inside the first 4 s poll interval: the form renders off the first poll, not a
    // later one (each poll before the fix was rejected the same way, so it never rendered).
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/organisation-device-request/);
    expect(auth0Hits, 'a public page must never bounce to Auth0').toBe(0);

    const adminConfig = calls.filter(call => call.operation === 'adminConfig');
    // One rejected attempt with the token, then the same operation again without it, then done.
    expect(adminConfig.map(call => call.authenticated)).toEqual([true, false]);
  });

  // #391 guard rail: the tokenless retry happens at most once per operation. If the anonymous
  // attempt is also rejected, the link gives up and the request fails as before (the page's own
  // poll then decides what to do), rather than looping.
  test('an anonymous retry that is also rejected with 401 is not retried again', async ({ page }) => {
    test.setTimeout(90_000);

    let auth0Hits = 0;
    await page.route(AUTH0_ORIGIN, route => {
      auth0Hits++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0 login</body></html>' });
    });

    await loginWith(page, ['read:kits']);
    await page.route(WARD_LOOKUP_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
    );
    const adminConfig: { authenticated: boolean; at: number }[] = [];
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      if (raw.includes('buildInfo')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { buildInfo: BUILD_INFO } }) });
      }
      if (raw.includes('adminConfig')) {
        adminConfig.push({ authenticated: Boolean((await route.request().allHeaders())['authorization']), at: Date.now() });
        // Rejected with or without a token.
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
    });

    await page.goto('/organisation-device-request');

    // Two polls' worth (the page re-polls every 4 s): each poll is one tokened attempt and at
    // most one tokenless retry, never two tokenless attempts in a row.
    await expect.poll(() => adminConfig.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    const sequence = adminConfig.map(call => call.authenticated);
    sequence.forEach((authenticated, i) => {
      expect(authenticated, `adminConfig attempt ${i + 1} of ${JSON.stringify(sequence)}`).toBe(i % 2 === 0);
    });
    // The retry follows its rejected attempt immediately; the next tokened attempt is the page's
    // own 4 s poll, not the link looping.
    expect(adminConfig[2].at - adminConfig[1].at).toBeGreaterThan(3_000);

    await expect(page).toHaveURL(/organisation-device-request/);
    await expect(page.getByText('E2E public request page content')).toHaveCount(0);
    expect(auth0Hits, 'a public page must never bounce to Auth0').toBe(0);
  });
});

// #391's invariant from the staff side: the tokenless retry is a public-page behaviour only. A
// 401 in the staff area still redirects and is never downgraded to an anonymous request.
test.describe('a staff-area 401 is never retried without the token @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an HTTP 401 on a staff page sends nothing tokenless', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route(AUTH0_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0 login</body></html>' }),
    );
    await loginWith(page, ['read:kits']);

    let rejected = 0;
    let tokenlessApollo = 0;
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      if (raw.includes('buildInfo')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { buildInfo: BUILD_INFO } }) });
      }
      // FeatureFlagsPublic is an HttpClient post that bypasses the Apollo links; always tokenless.
      if (raw.includes('FeatureFlagsPublic')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
      }
      if ((await route.request().allHeaders())['authorization']) {
        rejected++;
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
      }
      tokenlessApollo++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
    });

    await page.goto('/dashboard');
    await page.waitForURL(/auth0\.com\/authorize/, { timeout: 30_000 });
    await page.waitForTimeout(2_000);

    expect(rejected).toBeGreaterThan(0);
    expect(tokenlessApollo, 'Apollo operations retried without a token from a staff page').toBe(0);
  });
});
