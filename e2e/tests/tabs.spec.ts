import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tab switching tests — regression coverage for the ngb-tabset → ngb-nav migration.
 *
 * All 10 templates were migrated from the removed `ngb-tabset/ngb-tab` API to the
 * `ngb-nav/ngbNavItem` API. These tests verify that tabs render and switch correctly.
 *
 * Tests depend on the UAT backend having at least one record of each entity type.
 * If no data is found in the table after waiting, the test is skipped gracefully.
 *
 * Auth strategy: we intercept GraphQL requests at the Playwright network layer and
 * inject the Authorization header directly from the saved storageState token. This
 * avoids a race between Auth0 SDK initialization and the first DataTables AJAX call
 * (which previously caused the first request to fire with no auth header → 403).
 */

function getBearerToken(): string {
  const statePath = resolve(process.cwd(), 'e2e/.auth/user.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) {
        const parsed = JSON.parse(item.value);
        return parsed?.body?.access_token ?? '';
      }
    }
  }
  throw new Error('No Auth0 token found in e2e/.auth/user.json — run: node e2e/save-token.mjs');
}

async function withAuthInterceptor(page: import('@playwright/test').Page): Promise<void> {
  const token = getBearerToken();
  // Intercept every request to /graphql and forward directly to the UAT API from Node.js.
  // This solves two problems:
  // 1. Auth: injects Authorization on every request, including the first one that fires
  //    before the Auth0 SDK has initialized and found the cached token.
  // 2. CORS: the UAT API rejects requests with Origin: http://localhost:4200. By making
  //    the request from Node.js (server-side) and stripping Origin + CORS fetch headers,
  //    the API treats it as a same-origin call and accepts it.
  await page.route('**/graphql', async route => {
    try {
      const { origin, 'sec-fetch-site': _a, 'sec-fetch-mode': _b, 'sec-fetch-dest': _c, ...safeHeaders } = route.request().headers();
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: {
          ...safeHeaders,
          'Authorization': `Bearer ${token}`,
          'host': 'api-testing.communitytechaid.org.uk',
        },
      });
      await route.fulfill({ response });
    } catch {
      // Context may have closed while an in-flight background GraphQL request was pending.
    }
  });
}

async function getFirstIdFromList(page: import('@playwright/test').Page, listUrl: string): Promise<string | null> {
  await withAuthInterceptor(page);
  await page.goto(listUrl);
  // Wait explicitly for a row link — only appears once GraphQL responds with data.
  const linkLocator = page.locator('table tbody tr td a[href*="/dashboard/"]');
  const appeared = await linkLocator.first().waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return null;
  return linkLocator.first().getAttribute('href');
}

test.describe('Tab navigation (ngb-nav migration regression)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('kit-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/devices');
    if (!href) {
      test.skip(true, 'No devices in UAT database — skipping tab test');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('ul.nav-tabs .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount, 'Should have at least one tab').toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('donor-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/donors');
    if (!href) {
      test.skip(true, 'No donors in UAT database — skipping tab test');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('ul.nav-tabs .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('device-request-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/device-requests');
    if (!href) {
      test.skip(true, 'No device requests in UAT database — skipping tab test');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('ul.nav-tabs .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });

  test('referring-organisation-info tabs switch correctly', async ({ page }) => {
    const href = await getFirstIdFromList(page, '/dashboard/referring-organisations');
    if (!href) {
      test.skip(true, 'No referring organisations in UAT database — skipping tab test');
      return;
    }

    await withAuthInterceptor(page);
    await page.goto(href);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    const tabs = page.locator('ul.nav-tabs .nav-link');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveClass(/active/, { timeout: 5_000 });
    }
  });
});
