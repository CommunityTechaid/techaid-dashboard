/**
 * The /dashboard/posts routes carry a permission guard.
 *
 * Server side (techaid-server BlogGraph.kt): `postsConnection` is @PreAuthorize read:content, the
 * create/update/delete post mutations are write:content. Before the guard, a signed-in user
 * without read:content who typed /dashboard/posts got the page plus a persistent error toast
 * (the query is refused) instead of being turned away like the other guarded routes.
 *
 *   - list   /dashboard/posts          needs read:content
 *   - editor /dashboard/posts/:postId  needs write:content (the page is an editor; saving is
 *                                      write:content, and the Edit link is already gated on it)
 *
 * The no-access outcome is the same as updateScannerVisibleGuard's: a redirect to /dashboard.
 * Red on dev: with only AuthGuard the list route mounts, so the URL stays /dashboard/posts and a
 * findAllPosts query is sent.
 *
 * @mocked — all GraphQL stubbed; the session is synthetic (loginWith) so no token is needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

/** Stubs /graphql and returns the operation names seen (health probe excluded). */
async function installMocks(page: Page): Promise<string[]> {
  const ops: string[] = [];
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    // The startup `{ buildInfo }` health probe must be answered or "Server is starting up" replaces the page.
    if (raw.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const op = /(?:query|mutation)\s+(\w+)/.exec(body.query ?? '')?.[1] ?? '';
    ops.push(op);
    if (op === 'findAllPosts') {
      return fulfill(route, {
        postsConnection: {
          totalElements: 1,
          content: [{ id: 1, slug: 'about', title: 'About us', published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T10:00:00Z' }],
        },
      });
    }
    if (op === 'findPost') {
      return fulfill(route, {
        post: { id: 5, slug: 'about', title: 'About us', secured: false, content: '<p>hi</p>', published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T10:00:00Z' },
      });
    }
    return fulfill(route, {
      kits: { totalElements: 0 }, donors: { totalElements: 0 }, typeCount: [], statusCount: [],
      requestCount: { LAPTOP: 0, TABLET: 0, OTHER: 0, SMARTPHONE: 0, ALLINONE: 0, DESKTOP: 0, COMMSDEVICE: 0, BROADBANDHUB: 0 },
    });
  });
  return ops;
}

test.describe('posts routes are permission-guarded @mocked', () => {
  // The synthetic session below must be the only one; do not inherit the CI fake staff token.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('without read:content, /dashboard/posts redirects to /dashboard and no posts query is sent', async ({ page }) => {
    const ops = await installMocks(page);
    await loginWith(page, ['read:kits']);

    await page.goto('/dashboard/posts');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('#post-index')).toHaveCount(0);
    expect(ops).not.toContain('findAllPosts');
  });

  test('with read:content, /dashboard/posts shows the list', async ({ page }) => {
    const ops = await installMocks(page);
    await loginWith(page, ['read:content']);

    await page.goto('/dashboard/posts');

    await expect(page).toHaveURL(/\/dashboard\/posts$/);
    await expect(page.locator('#post-index tbody tr')).toHaveCount(1);
    await expect(page.locator('#post-index tbody')).toContainText('About us');
    expect(ops).toContain('findAllPosts');
  });

  test('without write:content, the post editor redirects to /dashboard and does not load the post', async ({ page }) => {
    const ops = await installMocks(page);
    await loginWith(page, ['read:content']);

    await page.goto('/dashboard/posts/5');

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(ops).not.toContain('findPost');
  });
});
