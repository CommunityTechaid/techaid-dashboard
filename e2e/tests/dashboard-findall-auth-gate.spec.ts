/**
 * The landing page ('' — see core-widgets.routes.ts) mounts DashboardIndexComponent. Four of
 * its findAll query's five fields (kits, donors, typeCount, statusCount) are @PreAuthorize'd
 * server-side and throw Access Denied without a token — measured against production on
 * 2026-07-22 as 138 of 206 findAll calls over 7 days, and ~70% of the API's WARN channel
 * (techaid-server issue #102).
 *
 * Two changes stop that, and this spec pins both:
 *
 *  1. '' now carries AuthGuard, so an anonymous visitor is sent to Auth0 instead of mounting
 *     the dashboard at all. This ALSO replaces a redirect that used to happen by accident:
 *     the failing findAll made the auth link reject with login_required, which tripped
 *     REAUTH_ERROR_CODES in graphql.module.ts. Gate the query without adding the guard and
 *     the landing page renders blank for anonymous visitors instead of prompting login.
 *
 *  2. DashboardIndexComponent holds findAll until isLoading$ has settled AND isAuthenticated$
 *     has emitted true — defence in depth, since the guard is now the primary stop. The
 *     isLoading$ half is load-bearing: isAuthenticated$ emits false synchronously on first
 *     navigation, before the SDK has read the cached session out of localStorage (the trap
 *     auth.guard.ts:22 documents).
 *
 * What these tests actually pin, established by reverting each change in turn and re-running:
 *   - Revert the GUARD (keeping the gate): the logged-out test goes red on waitForURL — the
 *     page sits on '/' rendering a blank dashboard instead of redirecting to login.
 *   - Revert the GATE (keeping the guard): BOTH tests stay green. The guard stops the
 *     component mounting at all, so the gate is unobservable through the router.
 *
 * So be honest about the gate: it is defence in depth with no independent regression cover
 * here, deliberately kept because it is the last line if '' ever loses its guard or the
 * component gets mounted somewhere new. If you are changing the gate, these tests will not
 * tell you that you broke it — reason it through, don't lean on a green run.
 *
 * @mocked so both run in the CI gate.
 */
import { test, expect } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';

/** Parsed operation names seen on /graphql, in order. */
async function trackGraphQL(page: import('@playwright/test').Page): Promise<string[]> {
  const operations: string[] = [];

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    let operationName = '';
    try {
      operationName = JSON.parse(raw).operationName ?? '';
    } catch {
      /* non-JSON body — leave it unnamed, it can't be the query under test */
    }
    operations.push(operationName);

    if (operationName === 'findAll') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    }

    // Everything else on the landing page gets an empty payload — this spec only
    // cares about findAll.
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  });

  return operations;
}

const countFindAll = (operations: string[]) => operations.filter(op => op === 'findAll').length;

test.describe('dashboard findAll waits for a token @mocked', () => {
  test.describe('logged out', () => {
    // A clean context: no storageState, so no Auth0 cache and no token.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('landing page redirects to login and issues no findAll', async ({ page }) => {
      // Stub the tenant rather than letting the run reach it: this asserts the app *attempted*
      // the login navigation without making CI depend on Auth0 being reachable.
      await page.route(AUTH0_ORIGIN, route =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><body>stub auth0 login</body></html>',
        }),
      );

      const operations = await trackGraphQL(page);

      await page.goto('/');

      // AuthGuard bounces the anonymous visitor instead of rendering a blank dashboard.
      await page.waitForURL(/auth0\.com/, { timeout: 30_000 });

      // And nothing hit the API on the way out.
      expect(countFindAll(operations)).toBe(0);
    });
  });

  test('landing page issues exactly one findAll once authenticated', async ({ page }) => {
    await authenticateWithPermissions(page, ['read:kits', 'read:donors']);

    const operations = await trackGraphQL(page);

    await page.goto('/');

    // The tiles only render once findAll has resolved (`@if (model)` in the template), so this
    // doubles as proof the guard admits the user and the gate lets the query through.
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Settle, then assert neither guard nor gate caused a duplicate fetch.
    await page.waitForTimeout(3_000);
    expect(countFindAll(operations)).toBe(1);
  });
});
