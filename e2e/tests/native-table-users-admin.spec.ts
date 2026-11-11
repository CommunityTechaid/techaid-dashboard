/**
 * Native tables (#113, milestone 3) — parity cover for the users-admin cluster:
 * user-index, role-users, role-permissions, user-permissions, user-roles.
 *
 * What must not change when a DataTables page becomes a cta-table:
 *  - the `users` resolver gets the STRINGS '1' / '-1' as the sort value, everything else gets
 *    'asc' / 'desc' (issue #72; the architecture contract says never "consistency-fix" it),
 *  - non-sortable columns stay inert (no request, no aria-sort),
 *  - page length and length menu, pager flavour, info line,
 *  - mutations reload the table and keep the page (remove a role / user / permission),
 *  - the odd table id `user=roles` still works.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

interface Vars {
  page?: { sort: { key: string; value: string }[]; size: number; page: number };
  term?: string;
  roleId?: string;
  userId?: string;
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const USERS = Array.from({ length: 12 }, (_, i) => ({
  id: `auth0|u${i + 1}`, userId: `auth0|u${i + 1}`, phoneNumber: '', email: `user${String(i + 1).padStart(2, '0')}@example.org`,
  name: `User ${String(i + 1).padStart(2, '0')}`, picture: '', lastLogin: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`, loginsCount: i + 1,
}));

interface State {
  calls: { op: string; vars: Vars }[];
  roleUsers: typeof USERS;
  userRoles: { id: string; name: string; description: string }[];
  userPerms: { resourceServerId: string; resourceServerName: string; name: string; description: string }[];
  rolePerms: { resourceServerId: string; resourceServerName: string; name: string; description: string }[];
  mutations: { op: string; vars: any }[];
}

async function installMocks(page: Page): Promise<State> {
  const st: State = {
    calls: [],
    roleUsers: USERS.slice(0, 7),
    userRoles: Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, name: `Role ${String(i + 1).padStart(2, '0')}`, description: `d${i + 1}` })),
    userPerms: [
      { resourceServerId: 'api', resourceServerName: 'API', name: 'read:direct', description: 'direct perm' },
      { resourceServerId: 'api', resourceServerName: 'API', name: 'read:viaRole', description: 'role perm' },
    ],
    rolePerms: Array.from({ length: 13 }, (_, i) => ({ resourceServerId: 'api', resourceServerName: 'API', name: `perm:${String(i + 1).padStart(2, '0')}`, description: `desc ${String(i + 1).padStart(2, '0')}` })),
    mutations: [],
  };
  const slice = <T,>(rows: T[], v: Vars) => rows.slice(v.page!.page * v.page!.size, (v.page!.page + 1) * v.page!.size);

  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    const body = JSON.parse(raw);
    const v: Vars = body.variables ?? {};
    const q: string = body.query ?? raw;
    const op = /(?:query|mutation)\s+(\w+)/.exec(q)?.[1] ?? '';

    if (op === 'findUser') return fulfill(route, { user: { id: 'u1', userId: 'auth0|u1', phoneNumber: '', email: 'u1@example.org', name: 'User 01', picture: '', lastLogin: '2026-01-01T00:00:00Z' } });
    if (op === 'findRole') return fulfill(route, { role: { id: 'r1', name: 'Role 01', description: 'd' } });

    if (op === 'findAllRoles') {
      const content = [{ id: 'r1', name: 'Role 01', description: 'd1' }];
      return fulfill(route, { roles: { totalElements: 1, number: 0, content } });
    }
    if (op === 'findAllUsers') {
      st.calls.push({ op: v.roleId ? 'role-users' : 'user-index', vars: v });
      if (v.roleId) {
        const rows = st.roleUsers.filter(u => !v.term || u.name.toLowerCase().includes(v.term.toLowerCase()));
        return fulfill(route, { role: { id: v.roleId, users: { totalElements: rows.length, number: v.page!.page, content: slice(rows, v) } } });
      }
      const term = (v.term ?? '').toLowerCase();
      const rows = USERS.filter(u => u.name.toLowerCase().includes(term));
      const dir = v.page!.sort[0]?.value === '-1' ? -1 : 1;
      rows.sort((a, b) => dir * a.lastLogin.localeCompare(b.lastLogin));
      return fulfill(route, { users: { totalElements: rows.length, number: v.page!.page, content: slice(rows, v) } });
    }
    if (op === 'findPermissions' && v.roleId) {
      st.calls.push({ op: 'role-permissions', vars: v });
      const rows = [...st.rolePerms];
      const key = (v.page!.sort[0]?.key ?? 'name') as 'name' | 'description';
      const dir = v.page!.sort[0]?.value === 'desc' ? -1 : 1;
      rows.sort((a, b) => dir * a[key].localeCompare(b[key]));
      return fulfill(route, { role: { id: v.roleId, name: 'Role 01', permissions: { totalElements: rows.length, number: v.page!.page, content: slice(rows, v) } } });
    }
    if (op === 'findPermissions') {
      st.calls.push({ op: 'user-permissions', vars: v });
      return fulfill(route, {
        user: {
          id: v.userId, permissions: { totalElements: st.userPerms.length, number: 0, content: slice(st.userPerms, v) },
          roles: { content: [{ name: 'Admin role', permissions: { items: [{ name: 'read:viaRole' }] } }] },
        },
      });
    }
    if (op === 'findRoles') {
      st.calls.push({ op: 'user-roles', vars: v });
      return fulfill(route, { user: { id: v.userId, roles: { totalElements: st.userRoles.length, number: v.page!.page, content: slice(st.userRoles, v) } } });
    }
    if (op === 'removeRoles') {
      st.mutations.push({ op, vars: v });
      const ids = (v as any).roleIds as string[];
      if (v.userId === 'u1') st.userRoles = st.userRoles.filter(r => r.id !== ids[0]);
      else st.roleUsers = st.roleUsers.filter(u => u.userId !== v.userId);
      return fulfill(route, { removeRoles: [{ id: v.userId }] });
    }
    if (op === 'removePermissions') {
      st.mutations.push({ op, vars: v });
      st.userPerms = st.userPerms.filter(p => p.name !== (v as any).permissions[0].name);
      return fulfill(route, { removePermissions: { userId: v.userId } });
    }
    return fulfill(route, {});
  });
  return st;
}

const last = (st: State, op: string) => st.calls.filter(c => c.op === op).at(-1)!.vars;
const count = (st: State, op: string) => st.calls.filter(c => c.op === op).length;

test.describe('native tables: users-admin cluster @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('cta-test-cleared')) {
          sessionStorage.setItem('cta-test-cleared', '1');
          Object.keys(localStorage).filter(k => k.startsWith('cta-table_')).forEach(k => localStorage.removeItem(k));
        }
      } catch { /* ignore */ }
    });
  });

  test('user-index: default order, "1"/"-1" sort strings, inert non-sortable headers, paging, search', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/users');
    const W = '#user-index_wrapper';
    await expect(page.locator('#user-index tbody tr')).toHaveCount(5);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 12 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['5', '10', '25', '50', '100']);
    await expect(page.locator(`${W} .dt-paging button.page-link.last`)).toHaveCount(1); // full_numbers
    // Last Login desc on load: the resolver gets '-1' and the server's column name, not 'desc'.
    expect(last(st, 'user-index').page!.sort).toEqual([{ key: 'last_login', value: '-1' }]);
    await expect(page.locator('#user-index tbody tr').first()).toContainText('User 12');
    const th = page.locator('#user-index thead th');
    await expect(th.nth(3)).toHaveAttribute('aria-sort', 'descending');

    // One click reverses (never clears, #336) and flips the string to '1'.
    await th.nth(3).click();
    await expect(th.nth(3)).toHaveAttribute('aria-sort', 'ascending');
    expect(last(st, 'user-index').page!.sort).toEqual([{ key: 'last_login', value: '1' }]);
    await expect(page.locator('#user-index tbody tr').first()).toContainText('User 01');

    // Name and Logins are not sortable: no request, no indicator.
    const before = count(st, 'user-index');
    await th.nth(1).click();
    await th.nth(2).click();
    await page.waitForTimeout(300);
    expect(count(st, 'user-index')).toBe(before);
    await expect(th.nth(1)).not.toHaveAttribute('aria-sort', /.+/);
    await expect(th.nth(3)).toHaveAttribute('aria-sort', 'ascending');

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 10 of 12 entries');
    expect(last(st, 'user-index').page).toMatchObject({ size: 5, page: 1 });

    const box = page.locator(`${W} .dt-search input`);
    await box.fill('User 1');
    await box.press('Enter');
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 3 of 3 entries (filtered from 12 total entries)');
    expect(last(st, 'user-index').term).toBe('User 1');
    // Row render: name link, email, initials avatar.
    await expect(page.locator('#user-index tbody tr').first()).toContainText('user');
  });

  test('role-users: 5 per page, "1"/"-1" sort, removing a user reloads the table', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/roles/r1');
    const W = '#role-users_wrapper';
    await expect(page.locator('#role-users tbody tr')).toHaveCount(5);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 5 of 7 entries');
    expect(last(st, 'role-users')).toMatchObject({ roleId: 'r1', page: { size: 5, page: 0, sort: [{ key: 'name', value: '-1' }] } });
    // Both columns are non-sortable: header clicks do nothing.
    const n = count(st, 'role-users');
    await page.locator('#role-users thead th').first().click();
    await page.waitForTimeout(300);
    expect(count(st, 'role-users')).toBe(n);

    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 7 of 7 entries');
    // Remove a user from the second page: the table reloads and stays on that page.
    await page.locator('#role-users tbody tr').first().locator('button').click();
    await page.locator('.modal-footer .btn-danger').click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 6 to 6 of 6 entries');
    expect(st.mutations.map(m => m.op)).toEqual(['removeRoles']);
    await expect(page.locator('#role-users tbody tr')).toHaveCount(1);
  });

  test('role-permissions: 10 per page, length menu without 5, plain asc/desc sort strings', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/roles/r1');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Permissions' }).click();
    const W = '#role-permissions_wrapper';
    await expect(page.locator('#role-permissions tbody tr')).toHaveCount(10);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 13 entries');
    await expect(page.locator(`${W} .dt-length select option`)).toHaveText(['10', '25', '50', '100']);
    expect(last(st, 'role-permissions').page!.sort).toEqual([{ key: 'description', value: 'desc' }]);
    await expect(page.locator('#role-permissions tbody tr').first()).toContainText('perm:13');
    const nameTh = page.locator('#role-permissions thead th').first();
    await nameTh.click();
    await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
    expect(last(st, 'role-permissions').page!.sort).toEqual([{ key: 'name', value: 'asc' }]);
    await expect(page.locator('#role-permissions tbody tr').first()).toContainText('perm:01');
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 13 of 13 entries');
  });

  test('user-permissions: direct and role-derived badges, removing a direct permission reloads', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/users/u1');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Permissions' }).click();
    const rows = page.locator('#user-permissions tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#user-permissions_wrapper .dt-info')).toHaveText('Showing 1 to 2 of 2 entries');
    // Rows derived by map + spread (Apollo v4 freezes responses): the badges prove they render.
    await expect(rows.filter({ hasText: 'read:direct' }).locator('.badge-secondary')).toHaveText('Direct');
    await expect(rows.filter({ hasText: 'read:viaRole' }).locator('.badge-primary')).toContainText('1 Role(s)');
    await expect(rows.filter({ hasText: 'read:viaRole' }).locator('[data-testid="permission-remove"]')).toBeDisabled();
    expect(last(st, 'user-permissions').page).toMatchObject({ size: 10, sort: [{ key: 'description', value: 'desc' }] });

    const n = count(st, 'user-permissions');
    await rows.filter({ hasText: 'read:direct' }).locator('[data-testid="permission-remove"]').click();
    await page.locator('[data-testid="permission-remove-confirm"]').click();
    await expect(rows).toHaveCount(1);
    expect(count(st, 'user-permissions')).toBeGreaterThan(n);
    expect(st.mutations[0].op).toBe('removePermissions');
  });

  // Issue #350: the detail tables' queries take no filter, so their search box did nothing. It is
  // hidden there; the two list tables keep theirs.
  test('search box is hidden on the four detail tables and kept on role-index and user-index', async ({ page }) => {
    await installMocks(page);
    const box = (id: string) => page.locator(`[id="${id}_wrapper"] .dt-search input`);

    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr').first()).toBeVisible();
    await expect(box('role-index')).toBeVisible();

    await page.goto('/dashboard/users');
    await expect(page.locator('#user-index tbody tr').first()).toBeVisible();
    await expect(box('user-index')).toBeVisible();

    // [page, tab to open (the first tab is already showing), table id]
    const details: [string, string | null, string][] = [
      ['/dashboard/roles/r1', null, 'role-users'],
      ['/dashboard/roles/r1', 'Permissions', 'role-permissions'],
      ['/dashboard/users/u1', null, 'user=roles'],
      ['/dashboard/users/u1', 'Permissions', 'user-permissions'],
    ];
    for (const [path, tab, id] of details) {
      await page.goto(path);
      if (tab) await page.locator('ul.nav-tabs .nav-link', { hasText: tab }).click();
      await expect(page.locator(`[id="${id}"] tbody tr`).first(), `${id} renders rows`).toBeVisible();
      await expect(page.locator(`[id="${id}_wrapper"] .dt-info`), `${id} still has its info line`).toBeVisible();
      await expect(box(id), `${id} has no search box`).toHaveCount(0);
    }
  });

  test('user-roles: table id "user=roles", paging and unassign reload', async ({ page }) => {
    const st = await installMocks(page);
    await page.goto('/dashboard/users/u1');
    const W = '[id="user=roles_wrapper"]';
    const rows = page.locator('[id="user=roles"] tbody tr');
    await expect(rows).toHaveCount(10);
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 1 to 10 of 12 entries');
    expect(last(st, 'user-roles').page).toMatchObject({ size: 10, sort: [{ key: 'description', value: 'desc' }] });
    await page.locator(`${W} .dt-paging button.page-link.next`).click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 12 of 12 entries');
    await rows.first().locator('[data-testid="role-unassign"]').click();
    await page.locator('[data-testid="role-unassign-confirm"]').click();
    await expect(page.locator(`${W} .dt-info`)).toHaveText('Showing 11 to 11 of 11 entries');
    expect(st.mutations.map(m => m.op)).toEqual(['removeRoles']);
  });
});
