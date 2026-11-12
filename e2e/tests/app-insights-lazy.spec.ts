/**
 * Application Insights is loaded lazily (perf: it was ~210 kB of the eager main bundle).
 *
 * AppInsightsService now fetches `@microsoft/applicationinsights-web` with a dynamic import()
 * straight after the first render. The first NavigationEnd fires BEFORE the SDK
 * has arrived, so the service buffers page views and flushes them once it loads. A regression
 * here would be silent: the app works, and Azure just loses the landing page of every session
 * (or all telemetry). This spec pins:
 *   - the landing route still produces a pageView (the buffered one), exactly once, and an
 *     in-app navigation after load produces another, posted to the configured ingestion
 *     endpoint under the production CSP;
 *   - with no connection string (local dev, the `assets/env.js` default) the SDK is never fetched;
 *   - if the SDK chunk fails to load, the app still renders and navigates; it only warns;
 *   - an error Angular catches (here: a lazy route whose chunk fails to load) reaches Azure as an
 *     exception tagged `source: angular-error-handler` (GlobalErrorHandler). Before, Angular only
 *     logged these to the console and Azure never saw them.
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

interface Envelope {
  tags?: Record<string, string>;
  data?: {
    baseType?: string;
    baseData?: { url?: string; properties?: Record<string, string>; exceptions?: { message?: string }[] };
  };
}
interface TrackedException { message: string; properties: Record<string, string> }

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
async function setUp(page: Page, connectionString: string): Promise<{ pageViews: string[]; sdkRequests: string[]; exceptions: TrackedException[]; roles: string[] }> {
  const pageViews: string[] = [];
  const exceptions: TrackedException[] = [];
  const roles: string[] = [];
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
      roles.push(env.tags?.['ai.cloud.role'] ?? '');
      if (env.data?.baseType === 'PageviewData' && env.data.baseData?.url) {
        pageViews.push(env.data.baseData.url);
      }
      if (env.data?.baseType === 'ExceptionData') {
        exceptions.push({
          message: env.data.baseData?.exceptions?.[0]?.message ?? '',
          properties: env.data.baseData?.properties ?? {},
        });
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
        // The app's health probe: without it the "Server is starting up" interstitial replaces the page.
        buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' },
        post: {
          __typename: 'Post', id: 'e2e-ai', title: 'e2e-ai', slug: 'e2e-ai-landing',
          content: '<p>App Insights landing page</p>', published: true, secured: false,
        },
      },
    }),
  }));
  return { pageViews, sdkRequests, exceptions, roles };
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
    const { pageViews, roles } = await setUp(page, CONNECTION_STRING);

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
    expect(new Set(roles), 'every envelope carries the dashboard role name').toEqual(new Set(['techaid-dashboard']));
  });

  test('without a connection string the SDK is never fetched', async ({ page }) => {
    test.setTimeout(60_000);
    const { pageViews, sdkRequests } = await setUp(page, '');

    await page.goto('/e2e-ai-landing');
    await expect(page.getByText('App Insights landing page')).toBeVisible({ timeout: 30_000 });
    // Ample time for the post-render load to have fired if it were wrongly scheduled.
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

  test('an error caught by Angular is reported as an exception', async ({ page }) => {
    test.setTimeout(120_000);
    const { exceptions } = await setUp(page, CONNECTION_STRING);
    // A lazy route whose chunk cannot be fetched: the router hands the failure to ErrorHandler.
    await page.route(/org-request[^/]*\.js/, route => route.abort());
    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/e2e-ai-landing');
    await expect(page.getByText('App Insights landing page')).toBeVisible({ timeout: 30_000 });
    await navigateInApp(page, '/organisation-device-request');

    await expect.poll(() => exceptions.filter(e => e.properties.source === 'angular-error-handler'),
      { timeout: 45_000, intervals: [1_000] }).not.toEqual([]);
    const reported = exceptions.find(e => e.properties.source === 'angular-error-handler');
    expect(reported.properties.route).toBeTruthy();
    expect(reported.message).not.toBe('');
    // The default handler's console output is kept.
    expect(consoleErrors.some(t => t.includes('ERROR'))).toBe(true);
  });
});
