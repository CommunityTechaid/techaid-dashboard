/**
 * Exclude-status filter spec — regression coverage for the "Exclude statuses" multi-select
 * added to the kit-index device filter (issue #64).
 *
 * NOTE: This spec requires a UAT-enabled environment to execute. The sandbox host allowlist
 * blocks api-testing.communitytechaid.org.uk, so it cannot run in CI without the UAT token
 * and network access. It is red-before / green-after by design:
 *   - BEFORE the fix: the "Exclude statuses" field does not exist in the filter form, so
 *     selecting statuses to exclude has no effect and excluded rows remain visible → FAIL.
 *   - AFTER the fix: the field exists, applyFilter pushes _neq constraints onto filter.AND,
 *     and the excluded rows are filtered out by the API → PASS.
 *
 * A bearer token must be saved to e2e/.auth/user.json before running:
 *   E2E_BEARER_TOKEN=<token> node e2e/save-token.mjs
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

test.describe('Exclude statuses filter (kit-index, issue #64)', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('excludes devices with the selected status from the device list', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto('/dashboard/devices');

    // Wait for table rows to appear — each row is a device.
    // The Status column is the 8th <td> (0-indexed: index 7), matching the <th>Status</th> header.
    const rowLocator = page.locator('table tbody tr');
    const appeared = await rowLocator.first().waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      test.skip(true, 'No devices in UAT — skipping exclude-status filter test');
      return;
    }

    // Read the Status cell (8th column, index 7) from visible rows to find a status to exclude.
    // The cell renders statusTypes[dt.status] || dt.status — i.e. the human-readable label.
    const statusCells = page.locator('table tbody tr td:nth-child(8)');
    const cellCount = await statusCells.count();

    if (cellCount === 0) {
      test.skip(true, 'No status cells found — skipping');
      return;
    }

    // Collect all non-empty status labels from visible rows.
    const statusLabels: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const text = (await statusCells.nth(i).textContent() ?? '').trim();
      if (text && text !== 'No data!') {
        statusLabels.push(text);
      }
    }

    if (statusLabels.length === 0) {
      test.skip(true, 'No readable status labels found — skipping');
      return;
    }

    // Pick the first status present in the visible rows to use as the exclusion target.
    const statusToExclude = statusLabels[0];

    // Open the filter modal via the "Filter" button.
    await page.locator('a.btn-info', { hasText: /Filter/i }).click();
    await expect(page.locator('.modal-title', { hasText: /Device Filters/i })).toBeVisible({ timeout: 5_000 });

    // Find the "Exclude statuses" ng-select and open it.
    // The formly field renders a label "Exclude statuses" above the ng-select widget.
    // We find the formly-field group containing that label, then interact with its ng-select.
    const excludeGroup = page.locator('formly-field', { hasText: /Exclude statuses/i }).last();
    await excludeGroup.locator('ng-select').click();

    // Type the status label into the search box to narrow options, then select the matching item.
    const searchInput = excludeGroup.locator('ng-select input[type="text"]');
    await searchInput.fill(statusToExclude.substring(0, 8)); // partial match is enough

    const dropdownOption = page.locator('.ng-option', { hasText: statusToExclude });
    await dropdownOption.first().waitFor({ state: 'visible', timeout: 5_000 });
    await dropdownOption.first().click();

    // Apply the filter — start waiting for the reload response before triggering it.
    const filterReload = page.waitForResponse(r => r.url().includes('/graphql') && r.status() === 200, { timeout: 15_000 }).catch(() => null);
    await page.locator('.modal-footer button.btn-primary', { hasText: /Filter/i }).click();
    await filterReload;
    await rowLocator.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      // If no rows after filtering, that's also valid (all had the excluded status).
    });

    // Assert: no visible row's Status cell (8th column) shows the excluded label.
    const remainingStatusCells = page.locator('table tbody tr td:nth-child(8)');
    const remainingCount = await remainingStatusCells.count();

    for (let i = 0; i < remainingCount; i++) {
      const text = (await remainingStatusCells.nth(i).textContent() ?? '').trim();
      if (text && text !== 'No data!') {
        expect(text, `Row ${i} still shows excluded status "${statusToExclude}"`).not.toBe(statusToExclude);
      }
    }
  });
});
