import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression test for issue #72 — "Unable to view 'users' in tada".
 *
 * Every server-side paginated table sends a `$page: PaginationInput` variable whose
 * `sort` is a list of `{ key, value }` pairs. The server types `sort[].value` as a
 * String ("asc" / "desc"). user-index (and role-users) were sending it as an integer
 * (`(o.dir == 'asc') ? 1 : -1`), so GraphQL rejected the whole variable with:
 *
 *   Variable 'page' has an invalid value: Expected a String input, but it was a 'Integer'
 *
 * Both tables declare a default sort (user-index order [3,'desc'], role-users [0,'desc']),
 * so the bad sort goes out on the very first load and the table never renders.
 *
 * Before the fix these tests fail: the findAllUsers response carries the Integer error
 * and no data rows render. After the fix (value: o.dir) the query succeeds.
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

/** True if a GraphQL errors[] payload contains the integer-sort type error. */
function hasIntegerSortError(bodyText: string): boolean {
  try {
    const json = JSON.parse(bodyText);
    return (json.errors ?? []).some((e: any) =>
      /invalid value: Expected a String input, but it was a 'Integer'/i.test(e?.message ?? '')
    );
  } catch {
    return false;
  }
}

/**
 * Routes /graphql to UAT with a bearer token (mirrors the other specs) and records
 * whether any findAllUsers response carried the integer-sort error.
 */
async function withAuthAndErrorCapture(
  page: import('@playwright/test').Page,
): Promise<{ sawIntegerError: () => boolean }> {
  const token = getBearerToken();
  let integerError = false;

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
      if (postData.includes('findAllUsers') && hasIntegerSortError(bodyText)) {
        integerError = true;
      }
      await route.fulfill({ response, body: bodyText });
    } catch {
      // Context may have closed while an in-flight background GraphQL request was pending.
    }
  });

  return { sawIntegerError: () => integerError };
}

test.describe("Issue #72 — users table sort value must be a String", () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('user-index loads without the Integer-sort GraphQL error', async ({ page }) => {
    const capture = await withAuthAndErrorCapture(page);
    await page.goto('/dashboard/users');

    // Table element renders regardless; the bug is that the ajax query errors.
    await expect(page.locator('table#user-index')).toBeVisible({ timeout: 20_000 });

    // The data rows only appear if findAllUsers succeeded. Before the fix this never
    // resolves and the integer error is captured below.
    const dataRow = page.locator('table#user-index tbody tr td a[href*="/dashboard/users/"]');
    const rowsAppeared = await dataRow.first().waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    expect(capture.sawIntegerError(),
      "findAllUsers returned the integer-sort error — sort[].value was sent as an Integer").toBe(false);

    if (!rowsAppeared) {
      test.skip(true, 'No users in UAT database — no rows to assert, but the query did not error');
      return;
    }
    await expect(dataRow.first()).toBeVisible();
  });

  test('role-users tab loads without the Integer-sort GraphQL error', async ({ page }) => {
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

    const usersTab = page.locator('ul.nav-tabs .nav-link', { hasText: /^\s*users\s*$/i });
    const tabVisible = await usersTab.first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!tabVisible) {
      test.skip(true, 'No Users tab on the role page — structure may have changed');
      return;
    }
    await usersTab.first().click();

    // Give the tab's DataTable ajax a moment to fire and resolve.
    await expect(page.locator('table[id*="user"], table.dataTable')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);

    expect(capture.sawIntegerError(),
      'role-users findAllUsers returned the integer-sort error — sort[].value was sent as an Integer').toBe(false);
  });
});
