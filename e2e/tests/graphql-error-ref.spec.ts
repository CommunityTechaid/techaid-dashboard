/**
 * #381 parts (a) and (b): every GraphQL request carries an error ref, and a failed operation is
 * reported to Application Insights once, with that ref and nothing personal.
 *
 * What it pins:
 *   - every GraphQL request the app sends carries a well-formed `X-CTA-Ref` header (8 characters
 *     from REF_ALPHABET) on the token path AND on the anonymous path (the auth link replaces
 *     `headers` on the token path, so a header added before it would be lost), and each request
 *     has its own ref;
 *   - an HTTP-200 `errors[]` response, an aborted request and an HTTP 500 each produce exactly ONE
 *     exception envelope with `source: apollo-error-link`, carrying the request's ref, and holding
 *     neither the server's message (a personal-data-like sentinel) nor the variables;
 *   - with no connection string nothing is sent to the ingestion host and nothing throws;
 *   - #391's tokenless retry of a public-page 401 keeps the SAME ref (and the header), is not
 *     reported when the retry succeeds, and is reported once when it fails too.
 *
 * Headers are read from what the browser actually sent (route.request().allHeaders()); nothing in
 * this file adds X-CTA-Ref or Authorization itself.
 *
 * Stubbing follows app-insights-lazy.spec.ts: `assets/env.js` sets a connection string whose
 * ingestion host is a mock covered by the CSP, that host and the SDK's CDN config fetch are
 * stubbed, and every GraphQL stub answers the `buildInfo` health probe (which is a plain fetch,
 * not Apollo, so it carries no ref and is not counted here).
 *
 * @mocked — GraphQL, Auth0 and the Azure endpoints are stubbed; no token needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginAsStaff, loginWith } from '../helpers/auth0-cache';

const INGEST_HOST = 'e2e-mock.in.applicationinsights.azure.com';
const CONNECTION_STRING =
  `InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://${INGEST_HOST}/`;
const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const WARD_LOOKUP_ORIGIN = '**://communitytechaid.github.io/**';
const BUILD_INFO = { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' };

/** 8 characters from the unambiguous alphabet: no 0/O, 1/I/L. */
const REF = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Personal-data-like text the stubbed server puts in its error message. Must never reach Azure. */
const SENTINEL_MESSAGE = 'Jane Sentinelperson jane.sentinel@example.org 07700 900123 must not be blank';
const SENTINELS = ['Sentinelperson', 'jane.sentinel@example.org', '07700 900123'];
/** Typed into the table search box, so it travels only in the query's variables. */
const VARIABLE_SENTINEL = 'VARSENTINELQX7';

interface Sent { operation: string; ref: string | undefined; authenticated: boolean; body: string }
interface Exception { message: string; properties: Record<string, string>; raw: string }

function parseEnvelopes(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
}

const operationOf = (body: string): string => {
  try {
    const name = JSON.parse(body).operationName;
    if (name) return name;
  } catch {
    /* not JSON */
  }
  // Some app queries are unnamed (e.g. the request form's adminConfig).
  return body.includes('adminConfig') ? 'adminConfig' : '';
};

/**
 * Stubs Azure, Auth0 and `assets/env.js`, and routes /graphql to `answer` (buildInfo is answered
 * here). Returns live arrays of what was sent and what was reported.
 */
async function setUp(
  page: Page,
  connectionString: string,
  answer: (route: Route, sent: Sent) => Promise<void>,
): Promise<{ sent: Sent[]; exceptions: Exception[]; pageViews: string[]; ingestRequests: string[] }> {
  const sent: Sent[] = [];
  const exceptions: Exception[] = [];
  const pageViews: string[] = [];
  const ingestRequests: string[] = [];
  page.on('request', r => { if (r.url().includes(INGEST_HOST)) ingestRequests.push(r.url()); });

  await page.route('**/assets/env.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__env = window.__env || {};\nwindow.__env.appInsightsConnectionString = ${JSON.stringify(connectionString)};\n`,
  }));
  await page.route(`https://${INGEST_HOST}/**`, async route => {
    const envelopes = parseEnvelopes(route.request().postData() ?? '') as any[];
    for (const env of envelopes) {
      if (env.data?.baseType === 'PageviewData' && env.data.baseData?.url) {
        pageViews.push(env.data.baseData.url);
      }
      if (env.data?.baseType === 'ExceptionData') {
        exceptions.push({
          message: env.data.baseData?.exceptions?.[0]?.message ?? '',
          properties: env.data.baseData?.properties ?? {},
          raw: JSON.stringify(env),
        });
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ itemsReceived: envelopes.length, itemsAccepted: envelopes.length, errors: [] }),
    });
  });
  await page.route(/https:\/\/[^/]*(monitor\.azure\.com|visualstudio\.com)\//, route =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.route(AUTH0_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub auth0</body></html>' }),
  );
  await page.route(WARD_LOOKUP_ORIGIN, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }),
  );
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfillData(route, { buildInfo: BUILD_INFO });
    }
    const headers = await route.request().allHeaders();
    const call: Sent = {
      operation: operationOf(body),
      ref: headers['x-cta-ref'],
      authenticated: Boolean(headers['authorization']),
      body,
    };
    sent.push(call);
    return answer(route, call);
  });
  return { sent, exceptions, pageViews, ingestRequests };
}

const fulfillData = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

const donorRow = (id: number, name: string) => ({
  id, name, postCode: 'SW9 0AA', phoneNumber: '07700900000', email: `${name.toLowerCase()}@example.org`,
  kitCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  archived: false, isLeadContact: false, donorParent: null,
});

const donorsPage = { donorsConnection: { totalElements: 1, content: [donorRow(1, 'REF-ALPHA')] } };

const postPage = (slug: string) => ({
  post: {
    __typename: 'Post', id: slug, title: slug, slug,
    content: `<p>Ref landing ${slug}</p>`, published: true, secured: false,
  },
});

/** Loads the donors table, then searches for VARIABLE_SENTINEL: that request is the one to fail. */
async function searchDonors(page: Page): Promise<void> {
  await page.goto('/dashboard/donors');
  await expect(page.locator('#donor-index tbody tr', { hasText: 'REF-ALPHA' })).toBeVisible({ timeout: 30_000 });
  const search = page.locator('input[aria-controls="donor-index"]');
  await search.fill(VARIABLE_SENTINEL);
  await search.press('Enter');
}

const isSentinelSearch = (call: Sent) => call.body.includes(VARIABLE_SENTINEL);

/**
 * Waits for the error-link exception carrying `ref`, then long enough for a duplicate to have
 * been sent in the same or the next batch, and returns every one carrying that ref.
 */
async function exceptionsFor(exceptions: Exception[], ref: string): Promise<Exception[]> {
  const matching = () => exceptions.filter(e => e.properties.source === 'apollo-error-link' && e.properties.ref === ref);
  // The SDK batches sends (maxBatchInterval 15 s), hence the generous poll.
  await expect.poll(() => matching().length, { timeout: 45_000, intervals: [1_000] }).toBeGreaterThan(0);
  await new Promise(resolve => setTimeout(resolve, 3_000));
  return matching();
}

/** Asserts the reported envelope is built from safe parts only. */
function expectSafe(reported: Exception, ref: string): void {
  expect(reported.message, 'the exception message names the ref').toContain(ref);
  expect(reported.properties.route).toBe('/dashboard/donors');
  for (const sentinel of [...SENTINELS, VARIABLE_SENTINEL]) {
    expect(reported.raw, `"${sentinel}" reached Azure`).not.toContain(sentinel);
  }
  expect(reported.raw).not.toContain('variables');
}

test.describe('GraphQL error ref, staff (token) path @mocked', () => {
  // A fresh staff session per test, independent of the saved e2e/.auth/user.json and its expiry.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => loginAsStaff(page));
  test('every request carries its own well-formed ref alongside the token', async ({ page }) => {
    test.setTimeout(90_000);
    const { sent } = await setUp(page, '', (route, call) =>
      fulfillData(route, call.operation === 'findAllDonors' ? donorsPage : {}));

    await searchDonors(page);
    await expect.poll(() => sent.filter(isSentinelSearch).length, { timeout: 15_000 }).toBeGreaterThan(0);

    expect(sent.length, 'the page sent GraphQL requests').toBeGreaterThanOrEqual(2);
    // The donors queries go through Apollo on the token path. (Public services such as the feature
    // flags post with HttpClient and no token; errorRefInterceptor gives those a ref too.)
    const donorQueries = sent.filter(call => call.operation === 'findAllDonors');
    expect(donorQueries.length).toBeGreaterThanOrEqual(2);
    for (const call of donorQueries) {
      expect(call.authenticated, 'findAllDonors went out on the token path').toBe(true);
    }
    for (const call of sent) {
      expect(call.ref, `${call.operation || call.body.slice(0, 80)} X-CTA-Ref`).toMatch(REF);
    }
    expect(new Set(sent.map(call => call.ref)).size, 'each request has its own ref').toBe(sent.length);
  });

  test('an HTTP-200 errors[] response is reported once, with the ref and no message or variables', async ({ page }) => {
    test.setTimeout(120_000);
    const { sent, exceptions } = await setUp(page, CONNECTION_STRING, (route, call) => {
      if (isSentinelSearch(call)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: null,
            errors: [{ message: SENTINEL_MESSAGE, path: ['donorsConnection'], extensions: { classification: 'ValidationError' } }],
          }),
        });
      }
      return fulfillData(route, call.operation === 'findAllDonors' ? donorsPage : {});
    });

    await searchDonors(page);
    await expect.poll(() => sent.filter(isSentinelSearch).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const failing = sent.filter(isSentinelSearch);
    const ref = failing[0].ref;
    expect(ref).toMatch(REF);

    const reported = await exceptionsFor(exceptions, ref);
    expect(reported, 'exactly one exception for the failed operation').toHaveLength(1);
    expectSafe(reported[0], ref);
    expect(reported[0].properties).toMatchObject({
      source: 'apollo-error-link', ref, operation: 'findAllDonors', kind: 'GraphQL', classification: 'ValidationError',
    });
  });

  for (const transport of [
    { name: 'an aborted request', kind: 'network', fail: (route: Route) => route.abort('failed') },
    { name: 'an HTTP 500', kind: 'HTTP 500', fail: (route: Route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ message: SENTINEL_MESSAGE }),
    }) },
  ]) {
    test(`${transport.name} is reported once, with the ref and no message or variables`, async ({ page }) => {
      test.setTimeout(120_000);
      const { sent, exceptions } = await setUp(page, CONNECTION_STRING, (route, call) =>
        isSentinelSearch(call) ? transport.fail(route) : fulfillData(route, call.operation === 'findAllDonors' ? donorsPage : {}));

      await searchDonors(page);
      await expect.poll(() => sent.filter(isSentinelSearch).length, { timeout: 15_000 }).toBeGreaterThan(0);
      const ref = sent.filter(isSentinelSearch)[0].ref;
      expect(ref).toMatch(REF);

      const reported = await exceptionsFor(exceptions, ref);
      expect(reported, 'exactly one exception for the failed operation').toHaveLength(1);
      expectSafe(reported[0], ref);
      expect(reported[0].properties).toMatchObject({
        source: 'apollo-error-link', ref, operation: 'findAllDonors', kind: transport.kind,
      });
    });
  }

  test('without a connection string a failed operation sends nothing and throws nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    const { sent, ingestRequests } = await setUp(page, '', (route, call) => {
      if (isSentinelSearch(call)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null, errors: [{ message: SENTINEL_MESSAGE }] }),
        });
      }
      return fulfillData(route, call.operation === 'findAllDonors' ? donorsPage : {});
    });

    await searchDonors(page);
    await expect.poll(() => sent.filter(isSentinelSearch).length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(sent.filter(isSentinelSearch)[0].ref).toMatch(REF);
    // Ample time for a wrongly scheduled send.
    await page.waitForTimeout(5_000);

    expect(ingestRequests, 'requests to the ingestion host').toEqual([]);
    expect(pageErrors, 'uncaught errors').toEqual([]);
  });
});

test.describe('GraphQL error ref, public (anonymous) path @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an anonymous visitor\'s requests carry their own well-formed ref and no token', async ({ page }) => {
    test.setTimeout(90_000);
    const { sent } = await setUp(page, '', route => fulfillData(route, postPage('e2e-ref-landing')));

    await page.goto('/e2e-ref-landing');
    await expect(page.getByText('Ref landing')).toBeVisible({ timeout: 30_000 });
    // The public post page sends more than one operation on load.
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    for (const call of sent) {
      expect(call.authenticated, `${call.operation} went out anonymously`).toBe(false);
      expect(call.ref, `${call.operation || call.body.slice(0, 80)} X-CTA-Ref`).toMatch(REF);
    }
    expect(new Set(sent.map(call => call.ref)).size, 'each request has its own ref').toBe(sent.length);
  });

  /**
   * The public request form's queries. Any tokened request is answered with 401, as the API
   * answers a token it will not accept (#391); `rejectAll` rejects the tokenless adminConfig too.
   */
  const publicForm = (options: { rejectAll?: boolean }) => (route: Route, call: Sent) => {
    if (call.authenticated || (options.rejectAll && call.operation === 'adminConfig')) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) });
    }
    const data =
      call.operation === 'adminConfig'
        ? {
            adminConfig: {
              canPublicRequestSIMCard: true, canPublicRequestLaptop: true, canPublicRequestPhone: true,
              canPublicRequestBroadbandHub: true, canPublicRequestTablet: true, canPublicRequestDesktop: true,
            },
          }
        : call.operation === 'findContent'
          ? { post: { id: '1', content: '<p>E2E public request page content</p>' } }
          : call.operation === 'findAutocompleteReferringOrgs'
            ? { referringOrganisationsPublic: [] }
            : {};
    return fulfillData(route, data);
  };

  test('#391\'s tokenless retry keeps the same ref and header, and a recovered 401 is not reported', async ({ page }) => {
    test.setTimeout(120_000);
    await loginWith(page, ['read:kits']);
    const { sent, exceptions, pageViews } = await setUp(page, CONNECTION_STRING, publicForm({}));

    await page.goto('/organisation-device-request');
    await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });

    const adminConfig = sent.filter(call => call.operation === 'adminConfig');
    expect(adminConfig.map(call => call.authenticated)).toEqual([true, false]);
    expect(adminConfig[0].ref).toMatch(REF);
    expect(adminConfig[1].ref, 'the tokenless retry is the same operation, so the same ref').toBe(adminConfig[0].ref);

    // Let at least one batch reach the mock host, then a full batch interval more: the retried
    // 401 recovered, so nothing may be reported for it.
    await expect.poll(() => pageViews.length, { timeout: 45_000, intervals: [1_000] }).toBeGreaterThan(0);
    await page.waitForTimeout(16_000);
    const forRef = exceptions.filter(e => e.properties.source === 'apollo-error-link' && e.properties.ref === adminConfig[0].ref);
    expect(forRef, 'a 401 the tokenless retry recovered from is not reported').toEqual([]);
  });

  test('a 401 that the tokenless retry does not recover is reported once, with the same ref', async ({ page }) => {
    test.setTimeout(120_000);
    await loginWith(page, ['read:kits']);
    const { sent, exceptions } = await setUp(page, CONNECTION_STRING, publicForm({ rejectAll: true }));

    await page.goto('/organisation-device-request');
    await expect.poll(() => sent.filter(call => call.operation === 'adminConfig').length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    const [first, retry] = sent.filter(call => call.operation === 'adminConfig');
    expect([first.authenticated, retry.authenticated]).toEqual([true, false]);
    expect(first.ref).toMatch(REF);
    expect(retry.ref).toBe(first.ref);

    const reported = await exceptionsFor(exceptions, first.ref);
    expect(reported, 'one report for the operation, not one per attempt').toHaveLength(1);
    expect(reported[0].properties).toMatchObject({ source: 'apollo-error-link', ref: first.ref, kind: 'HTTP 401' });
    expect(reported[0].properties.route).toBe('/organisation-device-request');
  });
});
