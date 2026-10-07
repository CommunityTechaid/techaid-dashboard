/**
 * User / role / permission admin screens against the REAL UAT Auth0 tenant.
 *
 * Why this exists: techaid-server PR #246 moved the Auth0 Management SDK from
 * 2.27.0 to 5.4.0 (a rewrite). The server now maps Auth0 objects into its own
 * GraphQL types; its contract tests only run against a fake Auth0. These specs
 * are the check that the mapping holds against `techaid-auth.eu.auth0.com`,
 * through the screens staff actually use:
 *
 *   User:       userId name email phoneNumber picture lastLogin loginsCount
 *   Role:       id name description
 *   Permission: resourceServerId resourceServerName name description
 *   Pages:      total start items
 *   Mutations:  assignRoles { id }, removeRoles { userId }
 *   Sort keys:  email, logins_count, last_login
 *
 * A renamed SDK field that the server forgets to map shows up as a BLANK cell,
 * not an error — so every check asserts on the GraphQL payload the page
 * received as well as on the rendered DOM.
 *
 * Every test also fails on any GraphQL `errors` and on any console error (see
 * `instrument()`).
 *
 * The role assign/remove test mutates real Auth0 state, so it runs ONLY against
 * a dedicated test user named by `E2E_ROLE_TEST_USER_ID` and skips with a reason
 * otherwise. It never touches the token's own account or any staff member.
 *
 * Not tagged @mocked: needs the real UAT backend and a valid bearer token.
 * Runs under either config; intended for `--config playwright.config.uat.ts`.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';

const UAT_API = 'https://api-testing.communitytechaid.org.uk/graphql';

/** The role the mutating test assigns and removes — the least-privileged role in the tenant. */
const OWNED_ROLE = 'METRICS_USER';
/** The role whose member list is paged end-to-end (large enough to need several pages). */
const PAGED_ROLE = 'VOLUNTEER';

/**
 * `lastLogin` has always been a Java `Date.toString()` string, e.g.
 * `Wed Oct 07 14:00:40 UTC 2026`. Not ISO-8601, not epoch millis.
 */
const JAVA_DATE_TOSTRING =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{2}:\d{2}:\d{2} [A-Z]{2,5} \d{4}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T/;

function decodeClaims(): Record<string, any> {
  const [, payload] = getBearerToken().split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  if (token.split('.')[2] === 'ci_fake_signature') {
    return 'CI fake token — real UAT Auth0 not reachable';
  }
  try {
    if (decodeClaims().exp * 1000 < Date.now()) {
      return 'UAT bearer token expired — run e2e/save-token.mjs with a fresh one';
    }
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

const tokenProblem = uatTokenUnavailable();

interface Exchange {
  op: string;
  variables: any;
  body: any;
}

interface Instrumented {
  exchanges: Exchange[];
  gqlErrors: string[];
  consoleErrors: string[];
  /** Resolves with the first exchange (after `since`) for `op` whose variables satisfy `match`. */
  next(op: string, match?: (vars: any) => boolean, since?: number): Promise<Exchange>;
}

/** Console noise that is not an app error (third-party hosts blocked by the config, synthetic Auth0 session). */
const IGNORED_CONSOLE = ['favicon', 'Failed to load resource', 'net::', 'Missing Refresh Token'];

/**
 * Forward every browser `/graphql` call to the real UAT API with the bearer
 * token (so the first request can't race the Auth0 SDK), record each
 * request/response pair, and collect GraphQL errors and console errors.
 */
async function instrument(page: Page): Promise<Instrumented> {
  const token = getBearerToken();
  const exchanges: Exchange[] = [];
  const gqlErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error' && !IGNORED_CONSOLE.some(s => msg.text().includes(s))) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

  await page.route('**/graphql', async route => {
    try {
      const headers = { ...route.request().headers() };
      delete headers['origin'];
      delete headers['sec-fetch-site'];
      delete headers['sec-fetch-mode'];
      delete headers['sec-fetch-dest'];
      const response = await route.fetch({
        url: UAT_API,
        headers: { ...headers, Authorization: `Bearer ${token}`, host: 'api-testing.communitytechaid.org.uk' },
      });
      const text = await response.text();
      let req: any = {};
      let body: any = null;
      try { req = JSON.parse(route.request().postData() ?? '{}'); } catch { /* not JSON */ }
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      const op = req.operationName ?? '';
      if (body?.errors?.length) {
        gqlErrors.push(`${op}: ${JSON.stringify(body.errors)}`);
      }
      exchanges.push({ op, variables: req.variables ?? {}, body });
      await route.fulfill({ response, body: text });
    } catch {
      // Context may have closed while an in-flight background request was pending.
    }
  });

  return {
    exchanges,
    gqlErrors,
    consoleErrors,
    async next(op, match = () => true, since = 0) {
      let found: Exchange | undefined;
      await expect
        .poll(() => {
          found = exchanges.slice(since).find(e => e.op === op && match(e.variables));
          return !!found;
        }, { message: `waiting for a ${op} response`, timeout: 30_000 })
        .toBe(true);
      return found!;
    },
  };
}

/** The DataTables v2 wrapper for a table id. */
const wrapper = (page: Page, tableId: string) => page.locator(`[id="${tableId}_wrapper"]`);

function assertMonotonic<T>(values: (T | null)[], cmp: (a: T, b: T) => number, dir: 1 | -1, label: string): void {
  const present = values.filter((v): v is T => v !== null && v !== undefined);
  for (let i = 1; i < present.length; i++) {
    expect(cmp(present[i - 1], present[i]) * dir, `${label}: ${present[i - 1]} then ${present[i]}`).toBeLessThanOrEqual(0);
  }
}

test.describe('User / role / permission admin vs real UAT Auth0 (server PR #246)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;
  let me: { userId: string; email: string; name: string };
  let roleIds: Record<string, string>;
  let gql: Instrumented;

  test.beforeAll(async () => {
    // Azure cold start can take ~2 min; warm the API up before the UI clock starts.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    const deadline = Date.now() + 120_000;
    let roles: { items: { id: string; name: string }[] };
    for (;;) {
      try {
        roles = (await uat.request<any>(`query { roles(page: { size: 50 }, filter: "") { items { id name } } }`)).roles;
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
    roleIds = Object.fromEntries(roles!.items.map(r => [r.name, r.id]));
    const claims = decodeClaims();
    me = {
      userId: claims.sub,
      email: claims['https://communitytechaid.org.uk/email'],
      name: claims['https://communitytechaid.org.uk/name'],
    };
  });

  test.afterAll(async () => {
    await uat?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    gql = await instrument(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect(gql.gqlErrors, 'no GraphQL errors on any response').toEqual([]);
    expect(gql.consoleErrors, 'no console errors').toEqual([]);
  });

  // ── 1. User list ────────────────────────────────────────────────────────────

  test('user list: first page, total, field shapes, page 2 has different users', async ({ page }) => {
    await page.goto('/dashboard/users');
    const first = await gql.next('findAllUsers', v => v.page?.page === 0 && !v.term);
    const page0 = first.body.data.users;
    const rows = page.locator('#user-index tbody tr');

    expect(page0.content.length, 'first page has users').toBeGreaterThan(0);
    await expect(rows).toHaveCount(page0.content.length, { timeout: 20_000 });
    expect(page0.totalElements, 'total >= rows on the page').toBeGreaterThanOrEqual(page0.content.length);
    expect(page0.number, 'first page starts at 0').toBe(0);
    await expect(wrapper(page, 'user-index').locator('.dt-info')).toContainText(`of ${page0.totalElements}`);

    for (const u of page0.content) {
      expect(u.userId, 'userId non-empty').toBeTruthy();
      expect(u.name, `name non-empty for ${u.userId}`).toBeTruthy();
      expect(u.email, `email non-empty for ${u.userId}`).toBeTruthy();
      if (u.lastLogin !== null) {
        expect(typeof u.loginsCount, `loginsCount is a number for ${u.userId}`).toBe('number');
      }
      if (u.loginsCount > 0) {
        expect(u.lastLogin, `lastLogin for ${u.userId}`).toMatch(JAVA_DATE_TOSTRING);
      }
      // Each user's row shows the email and either the Auth0 picture or initials.
      const row = rows.filter({ hasText: u.email });
      await expect(row).toHaveCount(1);
      if (u.picture) {
        expect(u.picture, `picture is a URL for ${u.userId}`).toMatch(/^https:\/\//);
        await expect(row.locator('img.avatar')).toHaveAttribute('src', u.picture);
      }
      if (u.lastLogin) {
        // Rendered through `date:'medium'` — a parse failure would leave the cell blank.
        await expect(row.locator('td').nth(3)).not.toBeEmpty();
      }
    }

    // ── page 2 ──
    const since = gql.exchanges.length;
    await wrapper(page, 'user-index').locator('button.page-link', { hasText: /^2$/ }).click();
    const second = await gql.next('findAllUsers', v => v.page?.page === 1, since);
    const page1 = second.body.data.users;
    expect(page1.number, 'page 2 start = page size').toBe(page0.content.length);
    expect(page1.totalElements, 'total stable across pages').toBe(page0.totalElements);
    expect(page1.content.length).toBeGreaterThan(0);
    const ids0 = new Set(page0.content.map((u: any) => u.userId));
    const overlap = page1.content.filter((u: any) => ids0.has(u.userId)).map((u: any) => u.email);
    expect(overlap, 'no user appears on both page 1 and page 2').toEqual([]);
    await expect(rows.first()).toContainText(page1.content[0].email, { timeout: 20_000 });
  });

  test('user list: search by email finds a known user', async ({ page }) => {
    await page.goto('/dashboard/users');
    await gql.next('findAllUsers', v => v.page?.page === 0);
    const since = gql.exchanges.length;
    const search = wrapper(page, 'user-index').locator('.dt-search input');
    await search.fill(me.email);
    await search.press('Enter');
    const res = await gql.next('findAllUsers', v => v.term === me.email, since);
    const items = res.body.data.users.content;
    expect(res.body.data.users.totalElements).toBeGreaterThanOrEqual(1);
    expect(items.map((u: any) => u.email)).toContain(me.email);
    await expect(page.locator('#user-index tbody tr').filter({ hasText: me.email })).toHaveCount(1, { timeout: 20_000 });
  });

  test('user list: every sort key orders the page and does not error', async ({ page }) => {
    // UI: only "Last Login" is orderable in user-index (Name/Logins columns are
    // orderable:false), so last_login goes through the real table; email and
    // logins_count go through the same `users` query directly.
    const byDate = (a: string, b: string) => Date.parse(a) - Date.parse(b);
    await page.goto('/dashboard/users');
    const desc = await gql.next('findAllUsers', v => v.page?.sort?.[0]?.key === 'last_login' && v.page.sort[0].value === '-1');
    const descDates = desc.body.data.users.content.map((u: any) => u.lastLogin);
    descDates.filter(Boolean).forEach((d: string) => expect(Date.parse(d), `parseable lastLogin ${d}`).not.toBeNaN());
    assertMonotonic(descDates, byDate, -1, 'last_login desc');

    // DataTables 2 cycles desc → unsorted → asc; the unsorted state must not error either.
    const header = page.locator('#user-index thead th', { hasText: 'Last Login' });
    let since = gql.exchanges.length;
    await header.click();
    await gql.next('findAllUsers', v => (v.page?.sort ?? []).length === 0, since);
    since = gql.exchanges.length;
    await header.click();
    const asc = await gql.next('findAllUsers', v => v.page?.sort?.[0]?.key === 'last_login' && v.page.sort[0].value === '1', since);
    const ascUsers = asc.body.data.users.content;
    assertMonotonic(ascUsers.map((u: any) => u.lastLogin), byDate, 1, 'last_login asc');
    expect(ascUsers.map((u: any) => u.userId), 'asc order differs from desc').not.toEqual(
      desc.body.data.users.content.map((u: any) => u.userId),
    );
    await expect(page.locator('#user-index tbody tr').first()).toContainText(ascUsers[0].email, { timeout: 20_000 });

    const SORT_QUERY = `query ($page: PaginationInput!) {
      users(page: $page, filter: "") { total start items { userId email loginsCount lastLogin } }
    }`;
    const fetchSorted = async (key: string, value: '1' | '-1') =>
      (await uat.request<any>(SORT_QUERY, { page: { size: 10, page: 0, sort: [{ key, value }] } })).users.items;

    const strCmp = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
    const emailAsc = await fetchSorted('email', '1');
    const emailDesc = await fetchSorted('email', '-1');
    assertMonotonic(emailAsc.map((u: any) => u.email), strCmp, 1, 'email asc');
    assertMonotonic(emailDesc.map((u: any) => u.email), strCmp, -1, 'email desc');
    expect(emailAsc[0].userId).not.toBe(emailDesc[0].userId);

    const numCmp = (a: number, b: number) => a - b;
    const loginsAsc = await fetchSorted('logins_count', '1');
    const loginsDesc = await fetchSorted('logins_count', '-1');
    assertMonotonic(loginsAsc.map((u: any) => u.loginsCount), numCmp, 1, 'logins_count asc');
    assertMonotonic(loginsDesc.map((u: any) => u.loginsCount), numCmp, -1, 'logins_count desc');
    // Users who never logged in come back with loginsCount null (Auth0 omits
    // logins_count) and sort first ascending — so compare identities, not values.
    expect(loginsDesc[0].loginsCount, 'highest logins_count is a positive number').toBeGreaterThan(0);
    expect(loginsAsc[0].userId).not.toBe(loginsDesc[0].userId);
  });

  // ── 2. User detail ──────────────────────────────────────────────────────────

  test('user detail: profile fields, lastLogin format, roles and permissions tabs', async ({ page }) => {
    await page.goto(`/dashboard/users/${encodeURIComponent(me.userId)}`);

    const user = (await gql.next('findUser', v => v.id === me.userId)).body.data.user;
    expect(user.userId).toBe(me.userId);
    expect(user.name, 'name').toBeTruthy();
    expect(user.email, 'email').toBe(me.email);
    expect(user.picture, 'picture').toMatch(/^https:\/\//);
    expect(user.lastLogin, 'lastLogin is not ISO-8601').not.toMatch(ISO_8601);
    expect(user.lastLogin, 'lastLogin is Java Date.toString()').toMatch(JAVA_DATE_TOSTRING);
    // The detail page itself only renders the name (breadcrumb); email/picture/
    // lastLogin are shown on the list row, covered by the list tests above.
    await expect(page.locator('.breadcrumb-item.active')).toHaveText(user.name);

    // Roles tab (default)
    const roles = (await gql.next('findRoles', v => v.userId === me.userId)).body.data.user.roles;
    expect(roles.content.length, 'user has roles').toBeGreaterThan(0);
    expect(roles.totalElements).toBeGreaterThanOrEqual(roles.content.length);
    const rolesTable = page.locator('[id="user=roles"]');
    for (const r of roles.content) {
      expect(r.id, 'role id').toBeTruthy();
      expect(r.name, `role name for ${r.id}`).toBeTruthy();
      await expect(rolesTable.getByRole('link', { name: r.name, exact: true })).toBeVisible({ timeout: 20_000 });
    }

    // Permissions tab
    const since = gql.exchanges.length;
    await page.locator('.nav-tabs a', { hasText: 'Permissions' }).click();
    const perms = (await gql.next('findPermissions', v => v.userId === me.userId, since)).body.data.user.permissions;
    expect(perms.content.length, 'user has permissions').toBeGreaterThan(0);
    expect(perms.totalElements).toBeGreaterThanOrEqual(perms.content.length);
    for (const p of perms.content) {
      expect(p.name, `permission name (${JSON.stringify(p)})`).toBeTruthy();
      expect(p.resourceServerId, `resourceServerId (${JSON.stringify(p)})`).toBeTruthy();
      expect(p.resourceServerName, `resourceServerName (${JSON.stringify(p)})`).toBeTruthy();
    }
    const permRows = page.locator('#user-permissions tbody tr');
    await expect(permRows).toHaveCount(perms.content.length, { timeout: 20_000 });
    for (const p of perms.content) {
      await expect(permRows.filter({ hasText: p.name })).not.toHaveCount(0);
    }
  });

  // ── 3. Role detail ──────────────────────────────────────────────────────────

  test(`role detail: ${PAGED_ROLE} member total agrees with rows paged through; permissions have names`, async ({ page }) => {
    test.setTimeout(120_000);
    const roleId = roleIds[PAGED_ROLE];
    expect(roleId, `${PAGED_ROLE} role exists`).toBeTruthy();
    await page.goto(`/dashboard/roles/${encodeURIComponent(roleId)}`);

    const rows = page.locator('#role-users tbody tr');
    const nextButton = wrapper(page, 'role-users').locator('button.page-link.next');
    const nextItem = wrapper(page, 'role-users').locator('li.dt-paging-button:has(button.page-link.next)');
    const seen: string[] = [];
    let total: number | null = null;
    let pageSize = 0;
    for (let n = 0; ; n++) {
      const res = await gql.next('findAllUsers', v => v.roleId === roleId && (v.page?.page ?? 0) === n);
      const users = res.body.data.role.users;
      total ??= users.totalElements;
      pageSize ||= res.variables.page.size;
      expect(users.totalElements, 'total stable across pages').toBe(total);
      expect(users.number, `page ${n + 1} start`).toBe(n * pageSize);
      for (const u of users.content) {
        expect(u.userId, 'member userId').toBeTruthy();
        expect(u.name, `member name for ${u.userId}`).toBeTruthy();
      }
      seen.push(...users.content.map((u: any) => u.userId));
      await expect(rows).toHaveCount(Math.max(users.content.length, 1), { timeout: 20_000 });
      if (users.content.length) {
        await expect(rows.first()).toContainText(users.content[0].name);
      }
      if (seen.length >= total! || users.content.length === 0) break;
      await expect(nextItem).not.toHaveClass(/disabled/);
      await nextButton.click();
    }
    expect(total!, `${PAGED_ROLE} has members`).toBeGreaterThan(0);
    expect(new Set(seen).size, 'no member appears on two pages').toBe(seen.length);
    expect(seen.length, 'rows summed across pages = total').toBe(total);
    if (total! > pageSize) {
      expect(seen.length, 'more than one page was walked').toBeGreaterThan(pageSize);
    }
    await expect(wrapper(page, 'role-users').locator('.dt-info')).toContainText(`of ${total}`);

    // Permissions tab
    const since = gql.exchanges.length;
    await page.locator('.nav-tabs a', { hasText: 'Permissions' }).click();
    const perms = (await gql.next('findPermissions', v => v.roleId === roleId, since)).body.data.role.permissions;
    expect(perms.content.length, `${PAGED_ROLE} has permissions`).toBeGreaterThan(0);
    for (const p of perms.content) {
      expect(p.name, `permission name (${JSON.stringify(p)})`).toBeTruthy();
      expect(p.resourceServerId, `resourceServerId (${JSON.stringify(p)})`).toBeTruthy();
    }
    const permRows = page.locator('#role-permissions tbody tr');
    await expect(permRows).toHaveCount(perms.content.length, { timeout: 20_000 });
    for (const p of perms.content) {
      await expect(permRows.filter({ hasText: p.name })).not.toHaveCount(0);
    }
  });

  // ── 4. Role assign / remove (mutating, real Auth0) ─────────────────────────

  test.describe('role assign/remove on the dedicated test user', () => {
    const testUserId = process.env.E2E_ROLE_TEST_USER_ID ?? '';
    const ROLES_QUERY = `query ($id: String!) {
      user(id: $id) { userId name email roles(page: { size: 50 }) { items { id name } } }
    }`;
    let originalRoleIds: string[] = [];
    let testUser: { name: string; email: string };
    let setupProblem: string | null = null;

    test.skip(
      !testUserId,
      'No dedicated Auth0 test user: set E2E_ROLE_TEST_USER_ID to an Auth0 user id whose name or email ' +
        'contains "e2e"/"test". The UAT tenant has none today and the e2e token is a real staff account.',
    );

    async function roleIdsOf(userId: string): Promise<string[]> {
      return (await uat.request<any>(ROLES_QUERY, { id: userId })).user.roles.items.map((r: any) => r.id).sort();
    }

    /** Put the test user's roles back exactly as found. Safe to call repeatedly. */
    async function restoreRoles(): Promise<void> {
      const current = await roleIdsOf(testUserId);
      const extra = current.filter(id => !originalRoleIds.includes(id));
      if (extra.length) {
        await uat.request(
          `mutation ($userId: String!, $roleIds: [String!]!) { removeRoles(userId: $userId, roleIds: $roleIds) { userId } }`,
          { userId: testUserId, roleIds: extra },
        );
      }
      for (const id of originalRoleIds.filter(id => !current.includes(id))) {
        await uat.request(
          `mutation ($roleId: String!, $userIds: [String!]!) { assignRoles(roleId: $roleId, userIds: $userIds) { id } }`,
          { roleId: id, userIds: [testUserId] },
        );
      }
    }

    test.beforeAll(async () => {
      const claims = decodeClaims();
      if (testUserId === claims.sub) {
        setupProblem = 'E2E_ROLE_TEST_USER_ID is the token owner — refusing to mutate a real staff account';
        return;
      }
      if (!(claims.permissions ?? []).includes('write:users')) {
        setupProblem = 'Token lacks write:users — assignRoles/removeRoles would be denied';
        return;
      }
      const user = (await uat.request<any>(ROLES_QUERY, { id: testUserId })).user;
      if (!user) {
        setupProblem = `E2E_ROLE_TEST_USER_ID ${testUserId} not found in the UAT tenant`;
        return;
      }
      if (!/e2e|test/i.test(`${user.name} ${user.email}`)) {
        setupProblem = `${testUserId} (${user.email}) does not look like a dedicated test user — refusing to mutate it`;
        return;
      }
      testUser = { name: user.name, email: user.email };
      originalRoleIds = user.roles.items.map((r: any) => r.id).sort();
      if (originalRoleIds.includes(roleIds[OWNED_ROLE])) {
        setupProblem = `Test user already holds ${OWNED_ROLE}; cannot test assigning it`;
      }
    });

    test(`assigns ${OWNED_ROLE}, sees it on user and role, removes it, sees it gone`, async ({ page }) => {
      test.skip(setupProblem !== null, setupProblem ?? '');
      test.setTimeout(150_000);
      const ownedRoleId = roleIds[OWNED_ROLE];
      expect(ownedRoleId, `${OWNED_ROLE} role exists`).toBeTruthy();
      const rolesTable = page.locator('[id="user=roles"]');
      const ownedLink = rolesTable.getByRole('link', { name: OWNED_ROLE, exact: true });

      try {
        // ── assign via the user page's Assign Roles modal ──
        await page.goto(`/dashboard/users/${encodeURIComponent(testUserId)}`);
        await gql.next('findRoles', v => v.userId === testUserId);
        await expect(ownedLink).toHaveCount(0);
        await page.getByTestId('role-assign-open').click();
        const roleSelect = page.locator('.modal-body ng-select');
        await roleSelect.waitFor({ state: 'visible', timeout: 10_000 });
        let since = gql.exchanges.length;
        await roleSelect.locator('input').fill('METRICS');
        await gql.next('findAutocompleteRoles', () => true, since);
        await page.locator('.ng-option', { hasText: `${OWNED_ROLE} (` }).first().click();
        since = gql.exchanges.length;
        await page.getByTestId('role-assign-submit').click();
        const assigned = await gql.next('assignRoles', v => v.roleId === ownedRoleId, since);
        expect(assigned.body.data.assignRoles, 'assignRoles returned a role').toBeTruthy();
        await expect(ownedLink, 'assigned role on the user').toBeVisible({ timeout: 20_000 });

        // ── it shows on the role's member list ──
        await page.goto(`/dashboard/roles/${encodeURIComponent(ownedRoleId)}`);
        const members = (await gql.next('findAllUsers', v => v.roleId === ownedRoleId)).body.data.role.users;
        expect(members.content.map((u: any) => u.userId), 'user is a member of the role').toContain(testUserId);
        await expect(page.locator('#role-users tbody tr').filter({ hasText: testUser.email })).toHaveCount(1, { timeout: 20_000 });

        // ── remove via the user page's row control ──
        await page.goto(`/dashboard/users/${encodeURIComponent(testUserId)}`);
        await expect(ownedLink).toBeVisible({ timeout: 20_000 });
        await rolesTable.locator('tbody tr').filter({ has: ownedLink }).getByTestId('role-unassign').click();
        await expect(page.locator('.modal-body')).toContainText(OWNED_ROLE);
        since = gql.exchanges.length;
        await page.getByTestId('role-unassign-confirm').click();
        const removed = await gql.next('removeRoles', v => v.userId === testUserId, since);
        expect(removed.body.data.removeRoles?.id, 'removeRoles returned the userId').toBe(testUserId);
        await expect(ownedLink, 'role gone from the user').toHaveCount(0, { timeout: 20_000 });

        // ── and gone from the role ──
        await page.goto(`/dashboard/roles/${encodeURIComponent(ownedRoleId)}`);
        const after = (await gql.next('findAllUsers', v => v.roleId === ownedRoleId)).body.data.role.users;
        expect(after.content.map((u: any) => u.userId), 'user no longer a member').not.toContain(testUserId);
        expect(await roleIdsOf(testUserId), 'roles back to the original set').toEqual(originalRoleIds);
      } finally {
        await restoreRoles();
      }
    });
  });
});
