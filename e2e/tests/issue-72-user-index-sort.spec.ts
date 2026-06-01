import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression test for issue #72 — "Unable to view 'users' in tada".
 *
 * The Users tables build a `$page: PaginationInput` whose `sort` is a list of
 * `{ key, value }` pairs. The `users` resolver validates the combined `key:value`
 * string against the pattern `^field:(1|-1)$` AND requires `value` to be a String.
 * user-index (and role-users) sent `value` as the integer `1`/`-1`, so GraphQL
 * rejected the whole variable with:
 *
 *   Variable 'page' has an invalid value: Expected a String input, but it was a 'Integer'
 *
 * The fix sends the string `'1'`/`'-1'` (NOT `"asc"`/`"desc"` — the users resolver
 * rejects those with a pattern error, unlike the other tables' resolvers).
 *
 * user-index declares a default sort (order [3,'desc']), so the bad value goes out
 * on the very first load and the table never renders. Before the fix this test fails
 * (a users-query GraphQL error is captured and no rows render); after it passes.
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

/**
 * Routes /graphql to UAT with a bearer token (mirrors the other specs) and records
 * the first GraphQL error returned by any users query (operation name contains
 * "findAllUsers", which covers both user-index and the role-users table query).
 */
async function withAuthAndErrorCapture(
  page: import('@playwright/test').Page,
): Promise<{ usersQueryError: () => string | null }> {
  const token = getBearerToken();
  let firstError: string | null = null;

  await page.route('**/graphql', async route => {
    try {
      const postData = route.request().postData() ?? '';
      const { origin, 'sec-fetch-site': _a, 'sec-fetch-mode': _b, 'sec-fetch-dest': _c, ...safeHeaders } =
        route.request().headers();
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: {
          ...safeHeaders,
          'Authorization': `Bearer ${token}`,
          'host': 'api-testing.communitytechaid.org.uk',
        },
      });
      const bodyText = await response.text();
      if (postData.includes('findAllUsers') && firstError === null) {
        try {
          const json = JSON.parse(bodyText);
          const err = (json.errors ?? [])[0]?.message;
          if (err) firstError = err;
        } catch { /* non-JSON body */ }
      }
      await route.fulfill({ response, body: bodyText });
    } catch {
      // Context may have closed while an in-flight background GraphQL request was pending.
    }
  });

  return { usersQueryError: () => firstError };
}

test.describe("Issue #72 — users table sort value must be the string '1'/'-1'", () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('user-index loads and renders rows without a users-query GraphQL error', async ({ page }) => {
    const capture = await withAuthAndErrorCapture(page);
    await page.goto('/dashboard/users');

    await expect(page.locator('table#user-index')).toBeVisible({ timeout: 20_000 });

    // UAT has users, so rows MUST render once the sorted query succeeds. Before the
    // fix the query errors, entities stay empty and no row links ever appear.
    const dataRow = page.locator('table#user-index tbody tr td a[href*="/dashboard/users/"]');
    await expect(dataRow.first()).toBeVisible({ timeout: 20_000 });

    expect(capture.usersQueryError(),
      'findAllUsers returned a GraphQL error — sort[].value was not the expected String "1"/"-1"')
      .toBeNull();
  });

  test('role-users tab loads without a users-query GraphQL error', async ({ page }) => {
    const capture = await withAuthAndErrorCapture(page);
    await page.goto('/dashboard/roles');

    const roleLink = page.locator('table tbody tr td a[href*="/dashboard/roles/"]');
    const roleAppeared = await roleLink.first().waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!roleAppeared) {
      test.skip(true, 'No roles in UAT database — cannot exercise the role-users tab');
      return;
    }

    await page.goto((await roleLink.first().getAttribute('href'))!);

    // role-info renders the Users tab via ngbNav (<a ngbNavLink>Users</a>).
    const usersTab = page.locator('.nav-tabs .nav-link', { hasText: /^\s*users\s*$/i });
    await expect(usersTab.first()).toBeVisible({ timeout: 15_000 });
    await usersTab.first().click();

    // Let the tab's DataTable ajax fire and resolve (role may have 0 users, so we
    // assert on the absence of an error rather than on rows).
    await expect(page.locator('table[id*="user"], table.dataTable').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);

    expect(capture.usersQueryError(),
      'role-users users query returned a GraphQL error — sort[].value was not the expected String "1"/"-1"')
      .toBeNull();
  });
});
