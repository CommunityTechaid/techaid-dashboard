/**
 * Anonymous-visitor cover for the third public Apollo surface: the unguarded `**` catch-all in
 * core-widgets.routes.ts, which mounts PostDataComponent for any path that matches no other
 * route (public content pages served by slug).
 *
 * Why it needs pinning. Unlike the public booking page — which deliberately bypasses Apollo via
 * booking-api.service.ts — PostDataComponent uses the shared Apollo client, and builds its
 * queryRef as a *field initialiser* (post-data.component.ts:60), so the query is constructed at
 * construction time and refetched from ngOnInit with the slug. Every anonymous visitor to a
 * content page therefore runs Apollo's auth link with no session. That is exactly the shape of
 * the 2026-07-28 production incident on /organisation-device-request (#159): the auth link saw
 * Auth0 reject getAccessTokenSilently() and bounced the visitor to the login page.
 *
 * The fix in #159 gates that redirect on authService.loggedIn, which makes this route safe
 * today — but this surface was never covered, so a regression here would have shipped silently
 * just as the original one did. This spec is the pin.
 *
 * @mocked — GraphQL stubbed and the Auth0 tenant intercepted; no token needed, runs in CI's
 * e2e-mocked gate.
 */
import { test, expect } from '@playwright/test';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const SLUG = 'about-our-work';

test.describe('anonymous visitor on a public content page @mocked', () => {
  // A genuine first-time visitor: no Auth0 cache, no cookies.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders the post and is never bounced to Auth0', async ({ page }) => {
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

    // PostDataComponent looks the post up by slug taken from the URL.
    const slugsRequested: string[] = [];
    await page.route('**/graphql', route => {
      const raw = route.request().postData() ?? '';
      try {
        const parsed = JSON.parse(raw);
        if (parsed.variables?.slug) {
          slugsRequested.push(parsed.variables.slug);
        }
      } catch {
        /* non-JSON body — not one of ours */
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            post: {
              id: '1',
              slug: SLUG,
              title: 'About our work',
              content: '<p>E2E public post body</p>',
            },
          },
        }),
      });
    });

    await page.goto(`/${SLUG}`);

    // Positive signal: the post actually rendered. Without it "never bounced to Auth0" would
    // pass just as happily on a page that never loaded.
    await expect(page.getByText('E2E public post body')).toBeVisible({ timeout: 30_000 });

    // Give any late redirect a beat to fire before judging.
    await page.waitForTimeout(2_000);

    await expect(page).toHaveURL(new RegExp(SLUG));
    expect(auth0Hits, 'a public content page must never bounce an anonymous visitor').toBe(0);
    expect(slugsRequested, 'the slug from the URL drives the lookup').toContain(SLUG);
  });
});
