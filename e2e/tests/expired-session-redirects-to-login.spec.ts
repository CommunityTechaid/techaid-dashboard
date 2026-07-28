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
 * Mechanism. authenticateWithPermissions(..., { expiredAccessToken: true }) seeds a stale
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
 * cached, so AuthGuard lets the route through. The assertion that a /graphql request was
 * actually attempted proves we got inside the component and that the auth link ran its error
 * path (it calls success({}) after redirecting, so the request still goes out untokened).
 *
 * @mocked — all GraphQL stubbed and the Auth0 tenant intercepted; no token needed, runs in
 * CI's e2e-mocked gate.
 */
import { test, expect } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';

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

    let graphqlAttempts = 0;
    await page.route('**/graphql', route => {
      graphqlAttempts++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { kits: [], donors: [], typeCount: [], statusCount: [], volunteerCount: [] },
        }),
      });
    });

    await authenticateWithPermissions(page, [], { expiredAccessToken: true });

    await page.goto('/dashboard');

    // The contract: the dying session is noticed and the user is sent to log in again.
    await page.waitForURL(/auth0\.com/, { timeout: 30_000 });

    expect(authorizeHits).toBeGreaterThan(0);
    // Proves the redirect came from the Apollo auth link (we were inside the component,
    // querying) and not from AuthGuard turning us away at the door.
    expect(graphqlAttempts).toBeGreaterThan(0);
  });
});
