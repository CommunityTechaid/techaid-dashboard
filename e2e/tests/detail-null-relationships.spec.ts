import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression test: user/role detail tabs must not crash when the back-end returns
 * null for the nested relationship fields.
 *
 * The back-end currently resolves `user(id).roles`, `user(id).permissions`,
 * `role(id).users` and `role(id).permissions` to null (no GraphQL error — the field
 * just comes back null). The DataTables ajax callbacks dereferenced that directly
 * (`data = res.data.user.roles; data['totalElements']`), throwing
 * `TypeError: Cannot read properties of null (reading 'totalElements')`, so the tab
 * hung forever on "Loading…".
 *
 * This test forces those nested fields to null in the GraphQL response (so it
 * reproduces the crash deterministically even after the back-end is fixed), then
 * asserts the tabs render without the null-deref TypeError. Before the front-end
 * guard it fails; after it passes.
 */

function getToken(): string {
  const s = JSON.parse(readFileSync(resolve(process.cwd(), 'e2e/.auth/user.json'), 'utf8'));
  for (const o of s.origins ?? []) for (const i of o.localStorage ?? [])
    if (i.name.startsWith('@@auth0spajs@@')) return JSON.parse(i.value)?.body?.access_token ?? '';
  throw new Error('No Auth0 token found in e2e/.auth/user.json — run: node e2e/save-token.mjs');
}

/** Route /graphql to UAT, force nested relationship fields to null, and collect null-deref errors. */
async function setup(page: import('@playwright/test').Page): Promise<{ nullDerefErrors: () => string[] }> {
  const token = getToken();
  const errors: string[] = [];
  const isNullDeref = (t: string) => /Cannot read properties of null|Cannot read property .* of null/.test(t);
  page.on('pageerror', e => { if (isNullDeref(`${e.message}`)) errors.push(`pageerror: ${e.message}`); });
  page.on('console', m => { if (m.type() === 'error' && isNullDeref(m.text())) errors.push(`console: ${m.text()}`); });

  await page.route('**/graphql', async route => {
    try {
      const { origin, 'sec-fetch-site': _a, 'sec-fetch-mode': _b, 'sec-fetch-dest': _c, ...h } = route.request().headers();
      const resp = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: { ...h, Authorization: `Bearer ${token}`, host: 'api-testing.communitytechaid.org.uk' },
      });
      let body = await resp.text();
      try {
        const j = JSON.parse(body);
        let changed = false;
        if (j?.data?.user) for (const k of ['roles', 'permissions']) if (k in j.data.user) { j.data.user[k] = null; changed = true; }
        if (j?.data?.role) for (const k of ['users', 'permissions']) if (k in j.data.role) { j.data.role[k] = null; changed = true; }
        if (changed) body = JSON.stringify(j);
      } catch { /* non-JSON */ }
      await route.fulfill({ response: resp, body });
    } catch { /* context closed mid-flight */ }
  });

  return { nullDerefErrors: () => errors };
}

/** Fetch a real userId and roleId straight from the GraphQL API (robust vs. UI scraping). */
async function fetchIds(): Promise<{ uid: string | null; rid: string | null }> {
  const token = getToken();
  const q = async (query: string, variables: any) => {
    const r = await fetch('https://api-testing.communitytechaid.org.uk/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return r.json() as any;
  };
  const page = { size: 1, page: 0, sort: [] as any[] };
  const u = await q('query($p:PaginationInput!,$t:String){ users(page:$p,filter:$t){ items{ userId } } }', { p: page, t: '' });
  const r = await q('query($p:PaginationInput!,$t:String){ roles(page:$p,filter:$t){ items{ id } } }', { p: page, t: '' });
  return { uid: u?.data?.users?.items?.[0]?.userId ?? null, rid: r?.data?.roles?.items?.[0]?.id ?? null };
}

test.describe('Detail pages survive null nested relationships', () => {
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

  test('user detail: Roles and Permissions tabs do not crash on null', async ({ page }) => {
    const cap = await setup(page);
    const { uid } = await fetchIds();
    if (!uid) { test.skip(true, 'No users in UAT'); return; }

    await page.goto(`/dashboard/users/${uid}`);
    // Roles tab is the default; then switch to Permissions.
    await expect(page.locator('.nav-tabs .nav-link', { hasText: /roles/i }).first()).toBeVisible({ timeout: 15_000 });
    const permissionsResp = page.waitForResponse(r => r.url().includes('/graphql') && r.status() === 200, { timeout: 15_000 }).catch(() => null);
    await page.locator('.nav-tabs .nav-link', { hasText: /permissions/i }).first().click();
    await permissionsResp;
    // The null-deref (if present) throws synchronously inside the DataTables ajax
    // callback right after the response resolves; there's no positive DOM signal for
    // "no error was thrown", so a short capped settle covers the callback's tick.
    await page.waitForTimeout(500);

    expect(cap.nullDerefErrors(), 'user detail tabs threw a null-deref on null relationships').toEqual([]);
  });

  test('role detail: Users and Permissions tabs do not crash on null', async ({ page }) => {
    const cap = await setup(page);
    const { rid } = await fetchIds();
    if (!rid) { test.skip(true, 'No roles in UAT'); return; }

    await page.goto(`/dashboard/roles/${rid}`);
    await expect(page.locator('.nav-tabs .nav-link', { hasText: /users/i }).first()).toBeVisible({ timeout: 15_000 });
    const permissionsResp = page.waitForResponse(r => r.url().includes('/graphql') && r.status() === 200, { timeout: 15_000 }).catch(() => null);
    await page.locator('.nav-tabs .nav-link', { hasText: /permissions/i }).first().click();
    await permissionsResp;
    // Same rationale as above: short capped settle for the synchronous ajax-callback throw.
    await page.waitForTimeout(500);

    expect(cap.nullDerefErrors(), 'role detail tabs threw a null-deref on null relationships').toEqual([]);
  });
});
