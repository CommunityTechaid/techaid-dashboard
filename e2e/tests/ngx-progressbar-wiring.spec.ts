/**
 * Regression cover for ngx-progressbar's major bump (11.1.0 to 14.0.0), a full API rewrite
 * (bcf6d08). The old NgProgress/NgProgressRef service-and-id lookup and this app's own
 * app-ngx-progress-http.ts interceptor were both deleted; main.ts now wires
 * `provideNgProgressHttp` + `withInterceptors([progressInterceptor])`, and app.component.ts
 * swapped `NgProgressComponent` for `NgProgressbar` and added the `NgProgressRouter` /
 * `NgProgressHttp` directives (app.component.html: two `<ng-progress>` elements, one per
 * directive). This is about that wiring, not a UI the user directly interacts with, so the
 * assertions are necessarily about DOM state rather than clicks.
 *
 * Covers: both progress-bar host elements mount (proves the component rename didn't silently
 * drop either directive), the HTTP-driven bar activates and completes around a real in-flight
 * GraphQL request, and the router-driven bar activates and completes around a real lazy-route
 * navigation (no route preloading is configured, so a first visit to a not-yet-loaded route
 * triggers a genuine dynamic import() — slowed via page.route to give a reliable window to
 * observe the "active" class in).
 *
 * Sanity-checked by breaking what each guards: temporarily deleting the `ngProgressHttp`
 * `<ng-progress>` element from app.component.html turns the mount-count and HTTP-activation
 * assertions red; deleting the `ngProgressRouter` element instead turns the mount-count and
 * router-activation assertions red — both confirmed, then reverted.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { test, expect, Page, Route } from '@playwright/test';

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };

test.describe('ngx-progressbar wiring (main.ts / app.component) @mocked', () => {
  test('both progress-bar host elements mount after the v14 rename', async ({ page }) => {
    test.setTimeout(60_000);
    await page.route('**/graphql', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      return fulfillJson(route, {});
    });

    await page.goto('/dashboard/devices');
    await expect(page.locator('app-root')).toBeVisible({ timeout: 30_000 });

    // NgProgressbar's selector is `ng-progress`; each directive host carries the base
    // `.ng-progress-bar` class unconditionally, proving the component actually mounted under
    // its new (renamed) selector rather than silently vanishing from the tree.
    const routerBar = page.locator('ng-progress[ngProgressRouter]');
    const httpBar = page.locator('ng-progress[ngProgressHttp]');
    await expect(routerBar).toHaveCount(1);
    await expect(httpBar).toHaveCount(1);
    await expect(routerBar).toHaveClass(/ng-progress-bar/);
    await expect(httpBar).toHaveClass(/ng-progress-bar/);
  });

  test('the HTTP-driven bar activates during an in-flight GraphQL request and completes after', async ({ page }) => {
    test.setTimeout(60_000);
    await page.route('**/graphql', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findAllKits')) {
        // Long enough to give a real window to observe the "active" class before it clears.
        await new Promise(r => setTimeout(r, 600));
        return fulfillJson(route, { kitsConnection: { totalElements: 0, number: 0, content: [] } });
      }
      return fulfillJson(route, {});
    });

    await page.goto('/dashboard/devices');
    const httpBar = page.locator('ng-progress[ngProgressHttp]');

    // Activates while the delayed findAllKits request is in flight...
    await expect(httpBar).toHaveClass(/ng-progress-bar-active/, { timeout: 10_000 });
    // ...and clears once it resolves.
    await expect(httpBar).not.toHaveClass(/ng-progress-bar-active/, { timeout: 10_000 });
  });

  test('the router-driven bar activates during a lazy route navigation and completes after', async ({ page }) => {
    test.setTimeout(60_000);
    const postId = 5555;
    await page.route('**/graphql', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findPost')) {
        return fulfillJson(route, {
          post: {
            id: postId, title: 'ROUTERBAR-POST-TITLE', slug: 'routerbar-post', secured: false, content: '',
            published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          },
        });
      }
      if (body.includes('findAllPosts')) return fulfillJson(route, { postsConnection: { totalElements: 0, content: [] } });
      return fulfillJson(route, {});
    });
    await page.goto(`/dashboard/posts/${postId}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'ROUTERBAR-POST-TITLE' })).toBeVisible({ timeout: 30_000 });

    // No route was visited before this one, so navigating away triggers a genuine dynamic
    // import() of post-index's lazy chunk (no preloading strategy is configured — see
    // main.ts). Slowing every subsequent script response gives that fetch a real window to
    // observe the router bar's "active" class in before NavigationEnd clears it.
    await page.route('**/*.js', async route => {
      await new Promise(r => setTimeout(r, 500));
      await route.continue();
    });
    const routerBar = page.locator('ng-progress[ngProgressRouter]');
    await page.getByRole('link', { name: 'Posts' }).click();
    await expect(routerBar).toHaveClass(/ng-progress-bar-active/, { timeout: 3_000 });
    await expect(routerBar).not.toHaveClass(/ng-progress-bar-active/, { timeout: 10_000 });
  });
});
