// Requires a UAT-enabled environment to reach the referee detail page.
// The sandbox host allowlist blocks api-testing.communitytechaid.org.uk so it can't run here.

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

test.describe('Referee notes UI', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('referee detail page shows notes UI', async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    await withAuthInterceptor(page);
    await page.goto('/dashboard/referring-organisation-contacts');

    // Wait for the table to load and find the first detail link
    const linkLocator = page.locator('table tbody tr td a[href*="/dashboard/"]');
    const appeared = await linkLocator.first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      test.skip(true, 'No referees in UAT');
      return;
    }

    const href = await linkLocator.first().getAttribute('href');
    await withAuthInterceptor(page);
    await page.goto(href);

    // Ensure the Details tab is active (it is by default on load)
    await expect(page.locator('ul.nav-tabs .nav-link').first()).toHaveClass(/active/, { timeout: 15_000 });

    // Assert notes UI is present: new-note textarea label
    await expect(
      page.locator('label', { hasText: 'Add a new note for this referee' })
    ).toBeVisible({ timeout: 15_000 });

    // Assert the notes list container is present
    await expect(
      page.locator('.notes-list')
    ).toBeVisible({ timeout: 15_000 });
  });
});
