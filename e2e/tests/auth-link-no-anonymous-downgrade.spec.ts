/**
 * The residual `findAll` Access Denied race, measured against production as a stable ~30% of
 * findAll calls per day (68% / 66% / 30% / 30% across 07-24…07-29) and NOT specific to findAll —
 * findAllKits picked up denials on 07-29 with nothing deployed in between.
 *
 * Root cause, in graphql.module.ts's asyncAuthLink: the error branch of
 * getTokenSilently$().subscribe(...) ends in `success({})` for EVERY rejection, which sends the
 * query with no Authorization header. The API answers HTTP 200 + GraphQL "Access Denied" — 200,
 * denied, no redirect, no console error, exactly the observed signature.
 *
 * Only three Auth0 error codes (REAUTH_ERROR_CODES) route to a login redirect. Everything else
 * silently downgrades to anonymous, and the SDK has plenty of "everything else":
 *
 *   - `invalid_grant` — the /oauth/token refresh grant rejected the refresh token. With refresh
 *     token rotation this is what a *concurrent* refresh gets when the other one wins the race
 *     and the reused token is detected. This spec uses it as the representative failure.
 *   - `request_error` — GenericError(error || 'request_error') from any non-OK token response
 *     (auth0-spa-js dist, getJSON: `throw new GenericError(error || "request_error", ...)`).
 *   - `timeout` — TimeoutError, thrown when the getTokenSilently lock can't be acquired in 10
 *     attempts, or when the token fetch aborts.
 *
 * Why the FIRST authenticated call of a page load is the one that gets hit: getTokenSilently()
 * dedupes concurrent calls via singlePromise(), keyed clientId::audience::scope. The SDK's own
 * init-time checkSession() takes out a fetch under that same key and then swallows its failure
 * (`catch (_) {}`), so init completes and the user still looks logged in — but a query firing in
 * that window joins the same promise and inherits the rejection.
 *
 * PR #153's component-level gate does not close this: it holds findAll until isAuthenticated$
 * emits true, but isAuthenticated$ being true is exactly the state in which the token refresh
 * can still transiently reject. The gate stops the *anonymous mount*; it cannot stop the *auth
 * link* from stripping the header afterwards.
 *
 * The staff and anonymous tests here are deliberately a matched pair, because the fix has to
 * discriminate between them and a previous attempt at this code path did not. On 2026-07-28 PR
 * #159 caused a production incident by making the redirect unconditional: Auth0 rejects
 * identically for "never had a session" and "session expired", so every anonymous visitor to the
 * public request form was bounced to Auth0 login.
 *
 *   staff  → token fetch fails → request must NOT go out unauthenticated  (the bug)
 *   anon   → token fetch fails → request MUST  go out unauthenticated     (the guard)
 *
 * The fix discriminates by reading isAuthenticated$ directly at the point of failure rather than
 * the `authService.loggedIn` field the old code used. loggedIn is assigned from a *separate*
 * subscription to that same observable inside AuthenticationService's constructor, and emission
 * order between two subscribers is not guaranteed — so on a cold load it can still be null when
 * the link consults it, misclassifying a staff user as anonymous and downgrading anyway.
 *
 * The anonymous test overlaps anon-public-request-no-login-redirect.spec.ts by design: that spec
 * pins "no redirect", this one pins "the unauthenticated request is still actually sent". A fix
 * that blocked anonymous requests outright would leave that spec green and this one red.
 *
 * What each test actually pins, established by reverting the graphql.module.ts fix and re-running:
 *   - "logged-in user whose token refresh fails" goes RED, with exactly the production signature:
 *     `Apollo queries sent with no Authorization header despite a logged-in session: ["findAll"]`.
 *     This is the discriminating test.
 *   - The anonymous test and the retry-recovery test stay GREEN either way. They are guard rails,
 *     not reproductions: they exist to fail a fix that over-corrects — one by blocking anonymous
 *     traffic (the 2026-07-28 incident), the other by failing requests that should have recovered.
 *     Do not read their passing as evidence the fix works.
 *
 * @mocked — all GraphQL and the Auth0 tenant are stubbed, no token needed; runs in CI's gate.
 */
import { test, expect } from '@playwright/test';
import { authenticateWithPermissions, buildAuth0CacheEntries } from '../helpers/auth0-cache';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

/**
 * Two GraphQL calls on every page load deliberately bypass Apollo and are always unauthenticated:
 * BackendStatusService's buildInfo probe (a raw fetch) and FeatureFlagService's featureFlagsPublic
 * (a plain HttpClient post). Both are documented as such — see feature-flag.service.ts, which
 * explains it uses HttpClient precisely so the Apollo auth link cannot bounce an anonymous visitor
 * — and both hit public resolvers that answer them fine. Production's own trace shows them
 * succeeding ("FeatureFlagsPublic ok", "buildInfo ok") immediately before the denied findAll.
 *
 * They never touch the auth link, so they are outside this spec's contract. Excluding them keeps
 * the assertion pointed at Apollo traffic instead of failing on correct behaviour.
 */
const NON_APOLLO_PUBLIC_PROBES = ['buildInfo', 'FeatureFlagsPublic'];

interface GraphQLCall {
  operationName: string;
  /** Whether the outgoing request carried an Authorization header. */
  authenticated: boolean;
  /** False for the two public probes that deliberately bypass the Apollo auth link. */
  viaApollo: boolean;
}

/**
 * Stub /graphql and record, per call, whether it was authenticated. `body` lets a caller answer
 * a specific operation with real-looking data; everything else gets an empty payload.
 */
async function trackGraphQL(
  page: import('@playwright/test').Page,
  responder: (operationName: string, raw: string) => object | undefined = () => undefined,
): Promise<GraphQLCall[]> {
  const calls: GraphQLCall[] = [];

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    let operationName = '';
    try {
      operationName = JSON.parse(raw).operationName ?? '';
    } catch {
      /* non-JSON body — can't be one of ours */
    }
    // QUERY_ADMIN_CONFIG is an unnamed query, so fall back to matching on the body.
    if (!operationName && raw.includes('adminConfig')) {
      operationName = 'adminConfig';
    }

    const headers = await route.request().allHeaders();
    calls.push({
      operationName,
      authenticated: Boolean(headers['authorization']),
      viaApollo: !NON_APOLLO_PUBLIC_PROBES.some(probe => raw.includes(probe)),
    });

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responder(operationName, raw) ?? { data: {} }),
    });
  });

  return calls;
}

test.describe('auth link never downgrades a staff request to anonymous @mocked', () => {
  test('logged-in user whose token refresh fails sends no unauthenticated query', async ({ page }) => {
    test.setTimeout(90_000);

    // A real staff session: identity cached, so isAuthenticated$ emits true, AuthGuard admits the
    // route and AuthenticationService.loggedIn is true. But the access token is already expired
    // and there IS a refresh token, so the SDK goes to the network to redeem it.
    await authenticateWithPermissions(page, ['read:kits', 'read:donors'], {
      expiredAccessToken: true,
      refreshToken: true,
    });

    // Registration order matters: Playwright matches routes in REVERSE order of registration, so
    // the broad tenant catch-all has to go first and the specific /oauth/token handler second,
    // or the catch-all swallows the token request and the refresh never appears to be attempted.
    //
    // The catch-all keeps the run offline and makes a login navigation show up as a URL change
    // rather than a hang.
    await page.route(AUTH0_ORIGIN, route =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      }),
    );

    // The transient failure. `invalid_grant` is not in REAUTH_ERROR_CODES, so the link's redirect
    // branch is skipped and — before the fix — control falls straight through to success({}).
    let tokenAttempts = 0;
    await page.route('**://techaid-auth.eu.auth0.com/oauth/token', route => {
      tokenAttempts++;
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Unknown or invalid refresh token.',
        }),
      });
    });

    const calls = await trackGraphQL(page, operationName =>
      operationName === 'findAll'
        ? {
            data: {
              kits: { totalElements: 42 },
              donors: { totalElements: 7 },
              typeCount: [{ type: 'LAPTOP', count: 10 }],
              statusCount: [{ status: 'DONATION_NEW', count: 3 }],
              requestCount: {
                LAPTOP: 5, TABLET: 0, OTHER: 0, SMARTPHONE: 0,
                ALLINONE: 0, DESKTOP: 0, COMMSDEVICE: 0, BROADBANDHUB: 0,
              },
            },
          }
        : undefined,
    );

    await page.goto('/');

    // Let the gate open, the refresh attempt fail, and any resulting query go out. Polling on
    // tokenAttempts rather than a flat sleep keeps this honest: we only judge the GraphQL calls
    // once the token fetch has actually been tried and rejected.
    await expect.poll(() => tokenAttempts, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(3_000);

    // The contract. Not "findAll didn't happen" — a retry that succeeds later is a perfectly good
    // outcome, and the next test asserts exactly that — but "no Apollo query left the browser
    // without an Authorization header". That is the thing that generates the API's Access Denied.
    const downgraded = calls.filter(call => call.viaApollo && !call.authenticated);
    expect(
      downgraded,
      `Apollo queries sent with no Authorization header despite a logged-in session: ` +
        `${JSON.stringify(downgraded.map(c => c.operationName || '(unnamed)'))}`,
    ).toEqual([]);

    // Sanity-check the negative result: the two public probes DID go out, so an empty
    // `downgraded` means "the auth link held findAll back", not "nothing loaded at all" or
    // "the route stub never matched".
    expect(calls.filter(call => !call.viaApollo).length).toBeGreaterThan(0);
  });

  test('a transient token failure recovers on retry and findAll goes out authenticated', async ({ page }) => {
    test.setTimeout(90_000);

    await authenticateWithPermissions(page, ['read:kits', 'read:donors'], {
      expiredAccessToken: true,
      refreshToken: true,
    });

    await page.route(AUTH0_ORIGIN, route =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      }),
    );

    // Model the refresh-token rotation race directly: this attempt loses with invalid_grant, but
    // the "winner" has by then written a fresh token to the shared cache. auth0-spa-js re-reads
    // localStorage on every getTokenSilently(), so the link's retry resolves from cache without a
    // second network call — which is why a retry is the right response to a transient failure and
    // not just optimism.
    const freshSession = buildAuth0CacheEntries(['read:kits', 'read:donors']);
    let tokenAttempts = 0;
    await page.route('**://techaid-auth.eu.auth0.com/oauth/token', async route => {
      tokenAttempts++;
      if (tokenAttempts === 1) {
        await page.evaluate(pairs => {
          for (const [key, value] of pairs as [string, string][]) {
            window.localStorage.setItem(key, value);
          }
        }, freshSession);
      }
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant' }),
      });
    });

    const calls = await trackGraphQL(page, operationName =>
      operationName === 'findAll'
        ? {
            data: {
              kits: { totalElements: 42 },
              donors: { totalElements: 7 },
              typeCount: [{ type: 'LAPTOP', count: 10 }],
              statusCount: [{ status: 'DONATION_NEW', count: 3 }],
              requestCount: {
                LAPTOP: 5, TABLET: 0, OTHER: 0, SMARTPHONE: 0,
                ALLINONE: 0, DESKTOP: 0, COMMSDEVICE: 0, BROADBANDHUB: 0,
              },
            },
          }
        : undefined,
    );

    await page.goto('/');

    // The tiles only render once findAll has resolved (`@if (model)` in the template), so this is
    // proof the user still got their data rather than a loud failure.
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const findAllCalls = calls.filter(call => call.operationName === 'findAll');
    expect(findAllCalls.length).toBeGreaterThan(0);
    expect(findAllCalls.every(call => call.authenticated)).toBe(true);
  });
});

test.describe('auth link still allows genuinely anonymous requests @mocked', () => {
  // Clean context: no Auth0 cache, no cookies — a genuine first-time visitor.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous visitor on the public request form still sends adminConfig unauthenticated', async ({ page }) => {
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
    await page.route(WARD_LOOKUP_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
    );

    const calls = await trackGraphQL(page, operationName => {
      if (operationName === 'adminConfig') {
        return {
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
        };
      }
      if (operationName === 'findContent') {
        return { data: { post: { id: '1', content: '<p>E2E public request page content</p>' } } };
      }
      if (operationName === 'findAutocompleteReferringOrgs') {
        return { data: { referringOrganisationsPublic: [] } };
      }
      return undefined;
    });

    await page.goto('/organisation-device-request');

    // adminConfig resolving flips backendStatus to 'ready', which renders the findContent body.
    // This is the positive signal that the health check completed unauthenticated rather than
    // being blocked or bounced.
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);

    await expect(page).toHaveURL(/organisation-device-request/);
    expect(auth0Hits).toBe(0);

    // The load-bearing half: adminConfig must have gone out, and must have gone out WITHOUT an
    // Authorization header. Blocking or stalling it is the 2026-07-28 incident in a new costume.
    const adminConfigCalls = calls.filter(call => call.operationName === 'adminConfig');
    expect(adminConfigCalls.length).toBeGreaterThan(0);
    expect(adminConfigCalls.every(call => !call.authenticated)).toBe(true);
  });
});
