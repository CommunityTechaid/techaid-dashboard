import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  throw new Error('No token');
}

async function registerInterceptor(page: import('@playwright/test').Page, label: string) {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    try {
      const { origin, 'sec-fetch-site': _a, 'sec-fetch-mode': _b, 'sec-fetch-dest': _c, ...safeHeaders } = route.request().headers();
      console.log(`[${label}] Intercepting GraphQL POST`);
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: { ...safeHeaders, 'Authorization': `Bearer ${token}`, 'host': 'api-testing.communitytechaid.org.uk' },
      });
      console.log(`[${label}] Response: ${response.status()}`);
      await route.fulfill({ response });
    } catch {
      // Context may have closed while an in-flight background GraphQL request was pending.
    }
  });
}

test('debug: detail page navigation with interceptor', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });

  // Step 1: Get a list link
  await registerInterceptor(page, 'list');
  await page.goto('/dashboard/devices');

  const linkLocator = page.locator('table tbody tr td a[href*="/dashboard/devices/"]');
  await linkLocator.first().waitFor({ state: 'visible', timeout: 15_000 });
  const href = await linkLocator.first().getAttribute('href');
  console.log('Got href:', href);

  // Step 2: Navigate to detail page
  console.log('Current URL before detail nav:', page.url());
  await page.goto(href);
  console.log('URL after goto:', page.url());

  // Step 3: Check what rendered
  await page.waitForTimeout(3000);
  const navTabsCount = await page.locator('ul.nav-tabs').count();
  const bodyText = await page.locator('body').innerText();
  console.log('Nav tabs found:', navTabsCount);
  console.log('Body text (200 chars):', bodyText.substring(0, 200));

  // Look for the overlay
  const overlayCount = await page.locator('.overlay').count();
  console.log('Overlay elements:', overlayCount);

  // Check router-outlet content
  const routerOutlet = await page.locator('router-outlet').count();
  console.log('router-outlet elements:', routerOutlet);

  await page.screenshot({ path: 'test-results/debug-detail.png' });

  expect(navTabsCount).toBeGreaterThan(0);
});
