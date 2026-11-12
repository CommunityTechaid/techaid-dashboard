/**
 * #115: the dashboard runs zoneless (`provideZonelessChangeDetection()`, no zone.js in polyfills).
 *
 * Why it needs pinning. zone.js is easy to bring back by accident (a dependency that imports
 * 'zone.js', a polyfills edit, `provideZoneChangeDetection()` re-added to main.ts), and nothing
 * would visibly break: the app just gets ~35 kB heavier and silently stops exercising the
 * zoneless repaint paths the rest of the suite relies on. This spec fails if `Zone` is on
 * `window`, and also checks the zoneless repaint itself: a view whose data arrives from an
 * async Apollo callback (PostDataComponent on the public `**` catch-all) must render it.
 *
 * @mocked — GraphQL and the Auth0 tenant are stubbed; no token needed. It also runs as-is
 * against deployed UAT (`--config playwright.config.uat.ts zoneless`), where the CSP is real.
 */
import { test, expect } from '../helpers/csp';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';

test.describe('zoneless change detection @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('zone.js is not loaded and async data still repaints', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route(AUTH0_ORIGIN, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0</body></html>' }),
    );
    await page.route('**/graphql', async route => {
      // Delay the response so the repaint has to come from the async callback, not the first render.
      await new Promise(r => setTimeout(r, 300));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            // Also answers the app's health probe ({ buildInfo }). Without it the probe never
            // succeeds, and once the interstitial grace period passes "Server is starting up"
            // replaces the router outlet for good: the test then failed whenever the page took
            // longer than that grace period to render (about 1 run in 10).
            buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' },
            post: {
              __typename: 'Post',
              id: '1',
              title: 'Zoneless repaint check',
              slug: 'zoneless-repaint-check',
              content: '<p>Rendered after an async Apollo response</p>',
              published: true,
              secured: false,
            },
          },
        }),
      });
    });

    await page.goto('/zoneless-repaint-check');

    await expect(page.getByText('Rendered after an async Apollo response')).toBeVisible({ timeout: 30_000 });

    const zone = await page.evaluate(() => typeof (window as unknown as { Zone?: unknown }).Zone);
    expect(zone, 'zone.js must not be loaded (#115)').toBe('undefined');
  });
});
