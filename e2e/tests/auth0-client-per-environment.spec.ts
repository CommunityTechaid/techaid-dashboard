/**
 * A non-production build must log in through the Dev & UAT Auth0 application, never the
 * production one. Until this was pinned, main.ts hard-coded the production client for every
 * build, which is why the production application had to allow localhost and app-testing as
 * callbacks — making a login on a developer laptop a login to production.
 *
 * Only the /authorize request is observed; it is answered with an empty page, so no login
 * completes and nothing else is stubbed.
 */
import { test, expect } from '@playwright/test';
import { DEV_CLIENT_ID } from '../helpers/auth0-clients';

const TENANT = 'techaid-auth.eu.auth0.com';

test.describe('Auth0 client per environment @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a non-production build sends logins to the Dev & UAT client', async ({ page }) => {
    let authorizeUrl: URL | undefined;
    await page.route(`**://${TENANT}/authorize*`, route => {
      authorizeUrl = new URL(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    });

    // '' carries AuthGuard, so an anonymous visit to / starts a login.
    await page.goto('/');

    await expect.poll(() => authorizeUrl, { timeout: 30_000 }).toBeDefined();
    expect(authorizeUrl!.searchParams.get('client_id')).toBe(DEV_CLIENT_ID);
  });
});
