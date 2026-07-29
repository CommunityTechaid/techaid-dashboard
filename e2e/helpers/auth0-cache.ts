/**
 * Synthetic Auth0 session for @mocked specs.
 *
 * The CI fake token deliberately carries `permissions: []` (see ci.yml), so any
 * spec covering permission-gated UI — bulk update, the update scanner — has to
 * write its own auth0-spa-js cache entry. The SDK never re-verifies the
 * signature of a *cached* token, only its shape and expiry, so a structurally
 * correct unsigned token is enough. See e2e/save-token.mjs for the derivation.
 *
 * Extracted from kit-id-list-bulk-update.spec.ts so the update-scanner spec can
 * reuse it rather than copy 80 lines of cache-shape trivia.
 */
import { Page } from '@playwright/test';

const CLIENT_ID = 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX';
const AUDIENCE = 'https://api.communitytechaid.org.uk';
const SCOPE = 'openid profile email offline_access';
const LEGACY_SCOPE = 'openid profile email';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export interface AuthOptions {
  /** Extra localStorage keys to seed alongside the Auth0 cache. */
  localStorage?: Record<string, string>;
  /** `sub` claim / display name, when a spec wants them distinguishable. */
  subject?: string;
  /**
   * Seed a *stale* session: identity still cached (isAuthenticated$ emits true, so
   * AuthenticationService.loggedIn is true and AuthGuard lets the route activate) but the
   * access-token entries are already expired and carry no refresh_token. The next
   * getAccessTokenSilently() therefore rejects with `missing_refresh_token` — the real
   * "staff session expired mid-use" shape that graphql.module.ts's redirect exists for.
   *
   * Both scope keys are expired together: leaving either one live would let the SDK serve a
   * token from the other and the rejection would never happen.
   */
  expiredAccessToken?: boolean;
  /**
   * Seed a refresh_token alongside the cached access token. Only meaningful together with
   * `expiredAccessToken`: with both, the next getAccessTokenSilently() has an expired entry
   * *and* something to redeem, so the SDK makes a real network POST to /oauth/token instead
   * of throwing `missing_refresh_token` locally. That lets a spec stub the token endpoint and
   * choose the failure shape — e.g. `invalid_grant` from refresh-token rotation, or a 5xx —
   * which is the transient class of failure that is NOT in REAUTH_ERROR_CODES.
   */
  refreshToken?: boolean;
}

/**
 * Builds the auth0-spa-js v2 localStorage entries for a session, without writing them.
 *
 * Exposed separately from authenticateWithPermissions so a spec can inject a *fresh* session
 * mid-flight — the way the winner of a refresh-token race repopulates the cache while a loser is
 * still retrying. auth0-spa-js with cacheLocation 'localstorage' re-reads localStorage on every
 * getTokenSilently(), so writing these keys is enough to make the next attempt succeed from cache
 * with no network call (and therefore no ID-token verification to satisfy).
 */
export function buildAuth0CacheEntries(
  permissions: string[],
  options: AuthOptions = {},
): [string, string][] {
  const subject = options.subject ?? 'auth0|e2e-synthetic';
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7200;

  const accessToken = [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e-synthetic' }),
    b64url({
      iss: 'https://techaid-auth.eu.auth0.com/',
      sub: subject,
      aud: [AUDIENCE],
      iat: now,
      exp,
      scope: SCOPE,
      permissions,
    }),
    'e2e_placeholder_sig',
  ].join('.');

  const idTokenClaims = {
    sub: subject,
    aud: CLIENT_ID,
    iss: 'https://techaid-auth.eu.auth0.com/',
    iat: now,
    exp,
    email: 'e2e@example.com',
    name: 'E2E Synthetic User',
  };
  const idToken = [
    b64url({ alg: 'RS256', typ: 'JWT', kid: 'e2e-synthetic' }),
    b64url(idTokenClaims),
    'e2e_placeholder_sig',
  ].join('.');
  const decodedToken = {
    claims: idTokenClaims,
    user: { sub: idTokenClaims.sub, email: idTokenClaims.email, name: idTokenClaims.name },
  };
  const body = {
    access_token: accessToken,
    id_token: idToken,
    ...(options.refreshToken ? { refresh_token: 'e2e-synthetic-refresh-token' } : {}),
    scope: SCOPE,
    expires_in: 7200,
    token_type: 'Bearer',
    audience: AUDIENCE,
    client_id: CLIENT_ID,
    decodedToken,
  };

  // The access-token cache expiry. auth0-spa-js treats an entry as stale 60s before its
  // expiresAt, so "already expired" has to clear that adjustment window, not just `now`.
  const tokenExpiresAt = options.expiredAccessToken ? now - 300 : exp;

  return [
    [
      `@@auth0spajs@@::${CLIENT_ID}::${AUDIENCE}::${SCOPE}`,
      JSON.stringify({ body, expiresAt: tokenExpiresAt }),
    ],
    [
      `@@auth0spajs@@::${CLIENT_ID}::${AUDIENCE}::${LEGACY_SCOPE}`,
      JSON.stringify({ body: { ...body, scope: LEGACY_SCOPE }, expiresAt: tokenExpiresAt }),
    ],
    [`@@auth0spajs@@::${CLIENT_ID}::@@user@@`, JSON.stringify({ id_token: idToken, decodedToken })],
    ...Object.entries(options.localStorage ?? {}),
  ];
}

/** Writes an auth0-spa-js v2 cache entry carrying the given permissions. */
export async function authenticateWithPermissions(
  page: Page,
  permissions: string[],
  options: AuthOptions = {},
): Promise<void> {
  const entries = buildAuth0CacheEntries(permissions, options);
  const exp = Math.floor(Date.now() / 1000) + 7200;

  await page.context().addCookies([
    {
      name: `auth0.${CLIENT_ID}.is.authenticated`,
      value: 'true',
      domain: 'localhost',
      path: '/',
      expires: exp,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.addInitScript(pairs => {
    for (const [key, value] of pairs as [string, string][]) {
      window.localStorage.setItem(key, value);
    }
  }, entries);
}
