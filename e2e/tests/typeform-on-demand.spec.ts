/**
 * The Typeform embed (script + stylesheet) is only needed by the public request form, so it is
 * injected by org-request.ts instead of being loaded from index.html on every page. Staff pages
 * must make no request to embed.typeform.com; the public request page must fetch embed.js.
 *
 * @mocked — all GraphQL and the Typeform host are stubbed, no token needed.
 */
import { test, expect } from '../helpers/csp';

const fulfillJson = (route: import('@playwright/test').Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

test.describe('Typeform loads on demand @mocked', () => {
  test('a staff page makes no request to embed.typeform.com', async ({ page }) => {
    test.setTimeout(60_000);
    const typeformRequests: string[] = [];
    page.on('request', req => {
      if (new URL(req.url()).hostname === 'embed.typeform.com') typeformRequests.push(req.url());
    });
    await page.route('**://embed.typeform.com/**', route => route.fulfill({ status: 200, body: '' }));
    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) {
        return fulfillJson(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      if (body.includes('findAllDonors')) {
        return fulfillJson(route, { donorsConnection: { totalElements: 0, content: [] } });
      }
      return fulfillJson(route, {});
    });

    await page.goto('/dashboard/donors');
    await expect(page.locator('#donor-index')).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    expect(typeformRequests).toEqual([]);
  });

  test('the public request page requests the Typeform embed script', async ({ page }) => {
    test.setTimeout(60_000);
    const embedRequest = page.waitForRequest('**://embed.typeform.com/next/embed.js', { timeout: 30_000 });
    await page.route('**://embed.typeform.com/**', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tf = {};' }),
    );
    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) {
        return fulfillJson(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      return fulfillJson(route, {});
    });

    await page.goto('/organisation-device-request');
    await embedRequest;
  });
});
