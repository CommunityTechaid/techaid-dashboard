/**
 * Login-callback cover for the guarded root route.
 *
 * main.ts sets `redirect_uri: window.location.origin`, so Auth0 returns EVERY user to '/' —
 * including users who deep-linked elsewhere, who land on '/' transiently before the SDK
 * forwards them to appState.target. Once '' carries AuthGuard (core-widgets.routes.ts), that
 * guard therefore runs on every single login callback. If it sampled isAuthenticated$ before
 * the SDK finished exchanging the code, it would call login() again — a login loop on the
 * application's front door. AuthGuard's isLoading$ gate (auth.guard.ts:24) is what prevents
 * that, and this spec is what proves it.
 *
 * HOW THIS WORKS WITHOUT CREDENTIALS: the SDK's own machinery runs for real — it generates the
 * state, nonce and PKCE challenge, writes the transaction, and verifies the id_token's claims
 * on the way back. Only the tenant's RESPONSES are stubbed: /authorize 302s straight back with
 * a code echoing the SDK's state, and /oauth/token returns an id_token carrying the nonce the
 * SDK just generated.
 *
 * This leans on auth0-spa-js verifying id_token CLAIMS (iss/aud/exp/nonce) but not the RSA
 * signature — true of v2.x, and the same property e2e/helpers/auth0-cache.ts already relies on.
 * If the SDK ever starts verifying signatures this spec fails at the callback rather than
 * misreporting; treat that as "update the stub", not "the guard broke".
 *
 * The assertion that matters is authorizeHits === 1. Two or more means a loop.
 */
import { test, expect, Page, Route } from '@playwright/test';

const TENANT = 'techaid-auth.eu.auth0.com';
const CLIENT_ID = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX';
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

interface Tenant {
  /** How many times the app navigated to /authorize. Must be 1 — more is a login loop. */
  authorizeHits: () => number;
  tokenHits: () => number;
}

async function stubAuth0(page: Page): Promise<Tenant> {
  let authorizeHits = 0;
  let tokenHits = 0;
  let nonce = '';

  // Registered first: Playwright matches the most recently registered route first, so the
  // specific handlers below win. This one only catches jwks/userinfo/logout stragglers.
  await page.route(`**://${TENANT}/**`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.route(`**://${TENANT}/authorize*`, async (route: Route) => {
    authorizeHits++;
    const url = new URL(route.request().url());
    nonce = url.searchParams.get('nonce') ?? '';
    const state = url.searchParams.get('state') ?? '';
    // Stand in for "user logs in successfully" — bounce straight back with an auth code.
    await route.fulfill({
      status: 302,
      headers: {
        Location: `http://localhost:4200/?code=e2e_code_${authorizeHits}&state=${encodeURIComponent(state)}`,
      },
      body: '',
    });
  });

  await page.route(`**://${TENANT}/oauth/token`, async (route: Route) => {
    tokenHits++;
    const now = Math.floor(Date.now() / 1000);
    const idToken = [
      b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e' }),
      b64url({
        iss: `https://${TENANT}/`,
        aud: CLIENT_ID,
        sub: 'auth0|e2e-callback',
        iat: now,
        exp: now + 7200,
        nonce,
        email: 'e2e@example.com',
        name: 'E2E Callback User',
      }),
      'e2e_placeholder_sig',
    ].join('.');
    const accessToken = [
      b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e' }),
      b64url({
        iss: `https://${TENANT}/`,
        sub: 'auth0|e2e-callback',
        aud: ['https://api.communitytechaid.org.uk'],
        iat: now,
        exp: now + 7200,
        scope: 'openid profile email offline_access',
        permissions: ['read:kits', 'read:donors'],
      }),
      'e2e_placeholder_sig',
    ].join('.');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        id_token: idToken,
        refresh_token: 'e2e_refresh',
        scope: 'openid profile email offline_access',
        expires_in: 7200,
        token_type: 'Bearer',
      }),
    });
  });

  return { authorizeHits: () => authorizeHits, tokenHits: () => tokenHits };
}

async function stubGraphQL(page: Page): Promise<void> {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    let operationName = '';
    try {
      operationName = JSON.parse(raw).operationName ?? '';
    } catch {
      /* ignore */
    }
    if (operationName === 'findAll') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            kits: { totalElements: 42 },
            donors: { totalElements: 7 },
            typeCount: [],
            statusCount: [],
            requestCount: {
              LAPTOP: 0, TABLET: 0, OTHER: 0, SMARTPHONE: 0,
              ALLINONE: 0, DESKTOP: 0, COMMSDEVICE: 0, BROADBANDHUB: 0,
            },
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  });
}

test.describe('Auth0 login callback through the guarded root @mocked', () => {
  // Clean context: no cached session, so the guard has to drive a real login.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('landing on / logs in once and renders the dashboard', async ({ page }) => {
    test.setTimeout(90_000);
    const tenant = await stubAuth0(page);
    await stubGraphQL(page);

    await page.goto('/');

    // The tiles only render once the guard has admitted us AND findAll resolved.
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL('http://localhost:4200/');

    expect(tenant.authorizeHits()).toBe(1); // >1 would be a login loop
    expect(tenant.tokenHits()).toBe(1);
  });

  test('a deep link survives the callback and lands on its target, not /', async ({ page }) => {
    test.setTimeout(90_000);
    const tenant = await stubAuth0(page);
    await stubGraphQL(page);

    // Auth0 returns to the origin, so this callback passes THROUGH the guarded '' route
    // before appState.target forwards it on. That transit is the risk being pinned here.
    await page.goto('/dashboard/devices');

    await expect(page).toHaveURL(/\/dashboard\/devices$/, { timeout: 30_000 });
    expect(tenant.authorizeHits()).toBe(1);
  });
});
