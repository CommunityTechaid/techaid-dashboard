/**
 * Audit "Who" column — System label for automated revisions.
 *
 * This spec needs a UAT-enabled environment to reach the kit detail page
 * (sandbox host allowlist blocks api-testing.communitytechaid.org.uk, so it
 * cannot run here); it is red-before / green-after by design — before the fix
 * the Who cell is blank for customUser "|", after it shows "System".
 *
 * The getAuditTrail GraphQL response is stubbed so the assertion does not depend
 * on whether UAT happens to have an automated revision.
 */

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

test.describe('Audit "Who" column — System label for automated revisions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('shows System in Who column when customUser is "|"', async ({ page }) => {
    // Step 1: navigate to devices list and grab the first kit detail link.
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

    const linkLocator = page.locator('table tbody tr td a[href*="/dashboard/"]');
    const appeared = await linkLocator.first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      test.skip(true, 'No devices in UAT');
      return;
    }

    const href = await linkLocator.first().getAttribute('href');

    // Step 2: register a MORE-SPECIFIC stub handler for the getAuditTrail query AFTER the
    // auth interceptor (Playwright runs the most-recently-added matching handler first).
    // If the POST body contains "getAuditTrail" or "kitAudits", fulfill with a canned
    // response containing one audit whose revision.customUser is "|".  Otherwise fall back
    // to the auth interceptor to proxy the request to UAT.
    await page.route('**/graphql', async route => {
      const postData = route.request().postData() ?? '';
      if (postData.includes('getAuditTrail') || postData.includes('kitAudits')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              kitAudits: [
                {
                  revision: {
                    id: 999,
                    timestamp: '2024-01-01T00:00:00Z',
                    customUser: '|',
                  },
                  type: 'MOD',
                  entity: {
                    model: 'Test Model',
                    status: 'DONATED',
                    serialNo: 'SN-TEST-001',
                    updatedAt: '2024-01-01T00:00:00Z',
                    createdAt: '2024-01-01T00:00:00Z',
                    subStatus: {
                      installationOfOSFailed: false,
                      wipeFailed: false,
                      needsSparePart: false,
                      needsFurtherInvestigation: false,
                      network: false,
                      installedOSName: null,
                      lockedToUser: false,
                    },
                  },
                },
              ],
            },
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Step 3: navigate to the kit detail page.
    await page.goto(href!);
    await expect(page.locator('[ngbNav], ul.nav-tabs')).toBeVisible({ timeout: 15_000 });

    // Step 4: click the Audit tab.
    const auditTab = page.locator('ul.nav-tabs .nav-link', { hasText: /Audit/i });
    await auditTab.click();
    await expect(auditTab).toHaveClass(/active/, { timeout: 5_000 });

    // Step 5: wait for the audit table to appear.
    const auditTable = page.locator('table[id*="kit-audit-"]');
    await expect(auditTable).toBeVisible({ timeout: 10_000 });

    // Step 6: assert the Who cell (3rd column) of the first audit row shows "System".
    // Columns: Revision #, When, Who, Model, Status, ...
    const whoCell = auditTable.locator('tbody tr:first-child td:nth-child(3)');
    await expect(whoCell).toHaveText('System', { timeout: 10_000 });
  });
});
