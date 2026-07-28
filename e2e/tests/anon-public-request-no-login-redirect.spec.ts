/**
 * Regression pin for the 2026-07-28 production incident: anonymous visitors to the public
 * tech-request form (/organisation-device-request — deliberately unguarded, see
 * core-widgets.routes.ts) were bounced to Auth0 login the moment the page loaded, so nobody
 * could submit a request.
 *
 * Root cause: PR #78 taught the Apollo auth link (graphql.module.ts) to redirectToLogin() on
 * Auth0's re-auth error codes. But the SDK rejects getAccessTokenSilently() identically for
 * "never had a session" and "session expired" — with useRefreshTokens: true and an empty cache
 * it throws missing_refresh_token locally, before any network call. So the adminConfig health
 * check the form fires in ngOnInit tripped the redirect for every anonymous visitor.
 *
 * The fix gates the redirect on authService.loggedIn, which only ever becomes true after
 * isAuthenticated$ emits true — never for an anonymous visitor. This spec pins the anonymous
 * side: a clean-profile load of the public form must fire adminConfig, render the form content,
 * and never navigate to (or even touch) the Auth0 tenant. Before the fix it fails on the URL
 * assertion — the page lands on the stubbed auth0.com login instead of staying put.
 *
 * The staff side of PR #78 (expired session mid-use still re-prompts) is not covered here:
 * loggedIn is true in that scenario, so the redirect path is unchanged.
 *
 * @mocked — all GraphQL stubbed, no token needed; runs in CI's e2e-mocked gate.
 */
import { test, expect } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
// The ready state embeds a ward-lookup iframe from this origin; stub it so the mocked run
// never leaves the machine.
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';

const ADMIN_CONFIG_RESPONSE = {
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

test.describe('anonymous public request form stays public @mocked', () => {
  // Clean context: no Auth0 cache, no cookies — a genuine first-time anonymous visitor.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anonymous load fires adminConfig and never navigates to Auth0', async ({ page }) => {
    test.setTimeout(90_000);

    // Count every request that reaches the tenant. loginWithRedirect() would navigate the top
    // frame to /authorize here — the incident behaviour. Zero hits is the contract.
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

    // Track which GraphQL operations fire. QUERY_ADMIN_CONFIG is an unnamed query, so match on
    // the body rather than operationName.
    const operations: string[] = [];
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      let operationName = '';
      try {
        operationName = JSON.parse(raw).operationName ?? '';
      } catch {
        /* non-JSON body — not one of ours */
      }

      if (raw.includes('adminConfig')) {
        operations.push('adminConfig');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(ADMIN_CONFIG_RESPONSE),
        });
      }
      operations.push(operationName);
      if (operationName === 'findContent') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { post: { id: '1', content: '<p>E2E public request page content</p>' } },
          }),
        });
      }
      if (operationName === 'findAutocompleteReferringOrgs') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { referringOrganisationsPublic: [] } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      });
    });

    await page.goto('/organisation-device-request');

    // adminConfig resolving flips backendStatus to 'ready', which renders the findContent
    // post body. This is the positive signal that the health check went through unauthenticated
    // instead of bouncing.
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

    // Give any late redirect a beat to fire before judging.
    await page.waitForTimeout(2_000);

    await expect(page).toHaveURL(/organisation-device-request/);
    expect(auth0Hits).toBe(0);
    expect(operations).toContain('adminConfig');
  });
});
