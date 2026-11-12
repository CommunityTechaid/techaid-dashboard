/**
 * Application Insights is loaded lazily (perf: it was ~210 kB of the eager main bundle).
 *
 * AppInsightsService now fetches `@microsoft/applicationinsights-web` with a dynamic import()
 * after the first render, when the browser is idle. The first NavigationEnd fires BEFORE the SDK
 * has arrived, so the service buffers page views and flushes them once it loads. A regression
 * here would be silent: the app works, and Azure just loses the landing page of every session
 * (or all telemetry). This spec pins:
 *   - the landing route still produces a pageView (the buffered one), exactly once, and an
 *     in-app navigation after load produces another, posted to the configured ingestion
 *     endpoint under the production CSP;
 *   - with no connection string (local dev, the `assets/env.js` default) the SDK is never fetched;
 *   - if the SDK chunk fails to load, the app still renders and navigates; it only warns.
 *
 * How: `assets/env.js` is stubbed to set a connection string whose IngestionEndpoint is a
 * hostname covered by the CSP's `https://*.in.applicationinsights.azure.com`, and that host is
 * stubbed with page.route, as is the SDK's CDN config fetch (js.monitor.azure.com), so nothing
 * leaves the machine.
 *
 * @mocked — GraphQL, Auth0 and the Azure endpoints are stubbed; no token needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const INGEST_HOST = 'e2e-mock.in.applicationinsights.azure.com';
const CONNECTION_STRING =
  `InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://${INGEST_HOST}/`;
/** The SDK module request: a vite dep under `ng serve` (`@microsoft_applicationinsights-web.js`). */
const SDK_MODULE = /applicationinsights-web/;

interface Envelope { data?: { baseType?: string; baseData?: { url?: string } } }

function parseEnvelopes(body: string): Envelope[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Newline-delimited form.
    return trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}

/** Stubs everything the public post page and the SDK touch. */
async function setUp(page: Page, connectionString: string): Promise<{ pageViews: string[]; sdkRequests: string[] }> {
  const pageViews: string[] = [];
  const sdkRequests: string[] = [];
  page.on('request', r => { if (SDK_MODULE.test(r.url())) sdkRequests.push(r.url()); });

  await page.route('**/assets/env.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__env = window.__env || {};\nwindow.__env.appInsightsConnectionString = ${JSON.stringify(connectionString)};\n`,
  }));
  await page.route(`https://${INGEST_HOST}/**`, async (route: Route) => {
    const envelopes = parseEnvelopes(route.request().postData() ?? '');
    for (const env of envelopes) {
      if (env.data?.baseType === 'PageviewData' && env.data.baseData?.url) {
        pageViews.push(env.data.baseData.url);
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ itemsReceived: envelopes.length, itemsAccepted: envelopes.length, errors: [] }),
    });
  });
  // The SDK's CDN config fetch (and anything else Azure-side) must not leave the machine.
  await page.route(/https:\/\/[^/]*(monitor\.azure\.com|visualstudio\.com)\//, route =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.route('**://techaid-auth.eu.auth0.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0</body></html>' }),
  );
  await page.route('**/graphql', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        post: {
          __typename: 'Post', id: 'e2e-ai', title: 'e2e-ai', slug: 'e2e-ai-landing',
          content: '<p>App Insights landing page</p>', published: true, secured: false,
        },
      },
    }),
  }));
  return { pageViews, sdkRequests };
}

/** In-app navigation without a link: Angular's Location listens to popstate. */
async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate(p => {
    history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
}

test.describe('Application Insights lazy load @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the first route and a later navigation are both tracked as page views', async ({ page }) => {
    test.setTimeout(120_000);
    const { pageViews } = await setUp(page, CONNECTION_STRING);

    await page.goto('/e2e-ai-landing');
    await expect(page.getByText('App Insights landing page')).toBeVisible({ timeout: 30_000 });

    // The landing page view was buffered before the SDK loaded and must be flushed after it does.
    // (The SDK batches sends; its default maxBatchInterval is 15 s, hence the generous poll.)
    await expect.poll(() => pageViews, { timeout: 45_000, intervals: [1_000] })
      .toContain('/e2e-ai-landing');

    // Same catch-all route (the post component is reused), but the router still emits a NavigationEnd.
    await navigateInApp(page, '/e2e-ai-second');
    await expect.poll(() => pageViews, { timeout: 45_000, intervals: [1_000] })
      .toContain('/e2e-ai-second');

    expect(pageViews.filter(u => u === '/e2e-ai-landing'), 'landing page tracked exactly once').toHaveLength(1);
  });

  test('without a connection string the SDK is never fetched', async ({ page }) => {
    test.setTimeout(60_000);
    const { pageViews, sdkRequests } = await setUp(page, '');

    await page.goto('/e2e-ai-landing');
    await expect(page.getByText('App Insights landing page')).toBeVisible({ timeout: 30_000 });
    // Give the idle callback (3 s timeout) ample time to have fired if it were wrongly scheduled.
    await page.waitForTimeout(5_000);

    expect(sdkRequests, 'SDK module requested with no connection string').toEqual([]);
    expect(pageViews).toEqual([]);
  });

  test('a failed SDK load leaves the app working and only warns', async ({ page }) => {
    test.setTimeout(60_000);
    const { sdkRequests } = await setUp(page, CONNECTION_STRING);
    await page.route(SDK_MODULE, route => route.abort());
    const warnings: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));

    await page.goto('/e2e-ai-landing');
    await expect(page.getByText('App Insights landing page')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => warnings.some(w => w.includes('Application Insights failed to load')),
      { timeout: 20_000 }).toBe(true);
    expect(sdkRequests.length, 'the SDK load was attempted').toBeGreaterThan(0);

    // Navigating after the failure (telemetry now dropped) must not throw either.
    await navigateInApp(page, '/e2e-ai-second');
    await expect(page.getByText('App Insights landing page')).toBeVisible();
    expect(pageErrors, 'uncaught errors after a failed SDK load').toEqual([]);
  });
});
