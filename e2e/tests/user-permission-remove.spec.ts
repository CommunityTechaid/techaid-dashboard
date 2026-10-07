/**
 * User detail → Permissions tab: removing a directly-assigned permission.
 *
 * The trash control used to send `removeUserPermissions(data: AddUserPermissionsInput!)`,
 * a mutation the server has never had in its schema (it exposes
 * `removePermissions(userId, permissions: [PermissionInput!]!)`), so every
 * click failed GraphQL validation and only showed an error toast.
 *
 * The server's PermissionInput binds all four fields as non-null Kotlin
 * properties, so the spec pins that every field is sent. Only permissions not
 * granted through a role ("Direct") can be removed; role-derived rows keep a
 * disabled control.
 *
 * Mocked: a real run would change a real Auth0 user's permissions.
 */
import { test, expect, Route } from '@playwright/test';

const USER_ID = 'auth0|e2e-permission-user';

const DIRECT = {
  resourceServerId: 'https://api.communitytechaid.org.uk',
  resourceServerName: 'Techaid API',
  name: 'write:content',
  description: null,
};
const VIA_ROLE = {
  resourceServerId: 'https://api.communitytechaid.org.uk',
  resourceServerName: 'Techaid API',
  name: 'read:kits',
  description: 'Read kits',
};

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

test.describe('user permissions: remove a direct permission @mocked', () => {
  test('sends removePermissions with the full PermissionInput and reloads the table', async ({ page }) => {
    const removals: { query: string; variables: any }[] = [];
    let permissionLoads = 0;

    await page.route('**/graphql', async route => {
      const req = JSON.parse(route.request().postData() ?? '{}');
      if ((req.query ?? '').includes('buildInfo')) {
        // The app's slow-server check: without it the route is swapped for a retry banner.
        return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      switch (req.operationName) {
        case 'findUser':
          return fulfill(route, { user: { id: USER_ID, userId: USER_ID, name: 'E2E Permission User', email: 'e2e@example.org', phoneNumber: null, picture: null, lastLogin: null } });
        case 'findRoles':
          return fulfill(route, { user: { id: USER_ID, roles: { totalElements: 0, number: 0, content: [] } } });
        case 'findPermissions':
          permissionLoads++;
          return fulfill(route, {
            user: {
              id: USER_ID,
              permissions: { totalElements: 2, number: 0, content: [DIRECT, VIA_ROLE] },
              roles: { content: [{ name: 'VOLUNTEER', permissions: { items: [{ name: VIA_ROLE.name }] } }] },
            },
          });
        case 'removePermissions':
          removals.push({ query: req.query, variables: req.variables });
          return fulfill(route, { removePermissions: { userId: USER_ID } });
        default:
          if ((req.query ?? '').includes('Permission')) {
            removals.push({ query: req.query, variables: req.variables });
          }
          return fulfill(route, {});
      }
    });

    await page.goto(`/dashboard/users/${encodeURIComponent(USER_ID)}`);
    await page.locator('.nav-tabs a', { hasText: 'Permissions' }).click();

    const rows = page.locator('#user-permissions tbody tr');
    const directRow = rows.filter({ hasText: DIRECT.name });
    const roleRow = rows.filter({ hasText: VIA_ROLE.name });
    await expect(directRow).toBeVisible({ timeout: 30_000 });
    await expect(directRow.getByTestId('permission-remove')).toBeEnabled();
    await expect(roleRow.getByTestId('permission-remove')).toBeDisabled();

    const loadsBefore = permissionLoads;
    await directRow.getByTestId('permission-remove').click();
    await expect(page.locator('.modal-body')).toContainText(DIRECT.name);
    await page.getByTestId('permission-remove-confirm').click();

    await expect.poll(() => removals.length, { timeout: 10_000 }).toBe(1);
    expect(removals[0].query).toContain('removePermissions(userId: $userId, permissions: $permissions)');
    expect(removals[0].variables).toEqual({
      userId: USER_ID,
      permissions: [{
        resourceServerId: DIRECT.resourceServerId,
        resourceServerName: DIRECT.resourceServerName,
        name: DIRECT.name,
        description: '',
      }],
    });
    // The table reloads after a successful removal.
    await expect.poll(() => permissionLoads, { timeout: 10_000 }).toBeGreaterThan(loadsBefore);
  });
});
