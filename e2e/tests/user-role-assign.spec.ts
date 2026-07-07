/**
 * Batch 5.6 — User role assign/remove write-flow spec.
 *
 * Exercises the staff user-administration workflow end-to-end through the UI
 * against the live UAT backend: on the user detail page's Roles tab, assign a
 * role via the Assign Roles modal (`role-assign-open` → ng-select typeahead →
 * `role-assign-submit`), see it appear in the roles table, then unassign it
 * via the row's trash control (`role-unassign` → `role-unassign-confirm`) and
 * see it disappear.
 *
 * ── SAFETY DESIGN (roles live in the shared Auth0 tenant) ────────────────────
 * assignRoles/removeRoles are backed by the Auth0 Management API, not the UAT
 * database — mutations here touch real auth state. The spec is therefore
 * deliberately conservative:
 *
 *   - The TARGET USER is the e2e test account itself (the `sub` claim of the
 *     bearer token) — never any real staff member.
 *   - The ROLE is METRICS_USER ("Limited reporting access"): the least-
 *     privileged role in the tenant, and effectively a subset of the
 *     METRICS_ADMIN the test account already holds — so even a worst-case
 *     residue grants nothing new.
 *   - Pre-existing roles are NEVER touched. The spec asserts the final role
 *     set is exactly the initial role set.
 *   - beforeAll removes a leftover METRICS_USER from a previous crashed run
 *     (only ever our own residue); afterAll re-checks and removes it again if
 *     the UI path died between assign and unassign.
 *
 * The assign→remove round-trip was verified directly against UAT before this
 * spec was written: both mutations succeed for this token (write:users) and
 * state restores exactly.
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid bearer token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';

/** Role this spec owns end-to-end. Verified present in the tenant. */
const ROLE_NAME = 'METRICS_USER';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is missing/expired or is the CI-minted fake (mirrors the pattern
 * in the other Batch 5 write-flow specs).
 */
function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') {
    return 'CI fake token — real UAT writes not possible';
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) {
      return 'UAT bearer token expired — run e2e/save-token.mjs with a fresh one';
    }
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

const tokenProblem = uatTokenUnavailable();

/** The e2e test account's Auth0 user id (the token's own subject). */
function tokenSubject(): string {
  const [, payload] = getBearerToken().split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub;
}

/**
 * Forward every browser `/graphql` call to the real UAT API from Node.js,
 * injecting the bearer token and stripping the Origin/CORS fetch headers the
 * UAT API rejects. Same interceptor the other real-UAT UI specs use.
 */
async function withAuthInterceptor(page: Page): Promise<void> {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    try {
      const safeHeaders = { ...route.request().headers() };
      delete safeHeaders['origin'];
      delete safeHeaders['sec-fetch-site'];
      delete safeHeaders['sec-fetch-mode'];
      delete safeHeaders['sec-fetch-dest'];
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: {
          ...safeHeaders,
          Authorization: `Bearer ${token}`,
          host: 'api-testing.communitytechaid.org.uk',
        },
      });
      await route.fulfill({ response });
    } catch {
      // Context may have closed while an in-flight background request was pending.
    }
  });
}

test.describe('User role assign/remove write-flow', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;
  let userId: string;
  let initialRoleNames: string[];

  /** Names of the roles the target user currently holds (via the same API the UI uses). */
  async function currentRoleNames(): Promise<string[]> {
    const res = await uat.request<{
      user: { roles: { items: { id: string; name: string }[] } };
    }>(
      `query ($id: String!) {
        user(id: $id) { roles(page: { size: 50 }) { items { id name } } }
      }`,
      { id: userId },
    );
    return res.user.roles.items.map(r => r.name).sort();
  }

  /** Remove METRICS_USER from the target user if present (our own residue only). */
  async function removeOwnedRoleIfPresent(): Promise<void> {
    const res = await uat.request<{
      user: { roles: { items: { id: string; name: string }[] } };
    }>(
      `query ($id: String!) {
        user(id: $id) { roles(page: { size: 50 }) { items { id name } } }
      }`,
      { id: userId },
    );
    const owned = res.user.roles.items.find(r => r.name === ROLE_NAME);
    if (owned) {
      await uat.request(
        `mutation ($userId: String!, $roleIds: [String!]!) {
          removeRoles(userId: $userId, roleIds: $roleIds) { id: userId }
        }`,
        { userId, roleIds: [owned.id] },
      );
    }
  }

  test.beforeAll(async () => {
    // The warm-up below may legitimately take ~2 min on an Azure cold start —
    // outlive the default 60s hook timeout or the hook dies before the loop.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    userId = tokenSubject();
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request(`query { roles(page: { size: 1 }, filter: "") { items { id } } }`);
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
    // Clean up residue from a previous crashed run, then record the baseline
    // role set this spec must leave untouched.
    await removeOwnedRoleIfPresent();
    initialRoleNames = await currentRoleNames();
    expect(
      initialRoleNames,
      `${ROLE_NAME} must not be pre-assigned — it is the role this spec owns`,
    ).not.toContain(ROLE_NAME);
  });

  test.afterAll(async () => {
    // Safety net: if the UI path died between assign and unassign, remove the
    // owned role so the test account's auth state is exactly as we found it.
    if (uat && userId) {
      await removeOwnedRoleIfPresent();
    }
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('assigns METRICS_USER to the e2e account via the modal and unassigns it via the row control', async ({ page }) => {
    test.setTimeout(120_000);
    await withAuthInterceptor(page);

    // ── 1. OPEN the e2e user's detail page (Roles tab is the default) ──────
    await page.goto(`/dashboard/users/${encodeURIComponent(userId)}`);
    await page.getByTestId('role-assign-open').waitFor({ state: 'visible', timeout: 30_000 });

    // The table id is literally "user=roles" (sic). The baseline roles the
    // account already holds must be listed before we touch anything.
    // Match role names via their exact link text: substring matching is unsafe
    // here (e.g. "ADMINISTRATOR" is contained in METRICS_ADMIN's description
    // "Metrics Administrator").
    const rolesTable = page.locator('[id="user=roles"]');
    for (const name of initialRoleNames) {
      await expect(rolesTable.getByRole('link', { name, exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await expect(rolesTable.getByRole('link', { name: ROLE_NAME, exact: true })).toHaveCount(0);

    // ── 2. ASSIGN via the modal's ng-select typeahead ───────────────────────
    await page.getByTestId('role-assign-open').click();
    const roleSelect = page.locator('.modal-body ng-select');
    await roleSelect.waitFor({ state: 'visible', timeout: 10_000 });

    const autocompleteResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAutocompleteRoles'),
      { timeout: 15_000 },
    );
    await roleSelect.locator('input').fill('METRICS');
    await autocompleteResp;
    // Exact-prefix match so METRICS_USER can't be confused with METRICS_ADMIN.
    const option = page.locator('.ng-option', { hasText: `${ROLE_NAME} (` }).first();
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    await option.click();

    const assignResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('assignRoles'),
      { timeout: 20_000 },
    );
    await page.getByTestId('role-assign-submit').click();
    const assignJson = await (await assignResp).json();
    expect(assignJson.errors, `assign must not error: ${JSON.stringify(assignJson.errors)}`).toBeFalsy();

    // The roles table reloads — the new role row must appear.
    const ownedRow = rolesTable
      .locator('tbody tr')
      .filter({ has: page.getByRole('link', { name: ROLE_NAME, exact: true }) });
    await expect(ownedRow, 'the assigned role should appear in the roles table').toBeVisible({ timeout: 20_000 });

    // ── 3. UNASSIGN via the row's trash control + confirm modal ─────────────
    await ownedRow.getByTestId('role-unassign').click();
    // The confirm modal names the role being removed.
    await expect(page.locator('.modal-body')).toContainText(ROLE_NAME, { timeout: 10_000 });

    const removeResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('removeRoles'),
      { timeout: 20_000 },
    );
    await page.getByTestId('role-unassign-confirm').click();
    const removeJson = await (await removeResp).json();
    expect(removeJson.errors, `remove must not error: ${JSON.stringify(removeJson.errors)}`).toBeFalsy();

    await expect(ownedRow, 'the unassigned role should disappear from the roles table').toHaveCount(0, {
      timeout: 20_000,
    });

    // ── 4. VERIFY the account's role set is exactly what we started with ────
    const finalRoles = await currentRoleNames();
    expect(finalRoles, 'the spec must leave the test account\'s roles untouched').toEqual(initialRoleNames);
  });
});
