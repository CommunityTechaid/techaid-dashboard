/**
 * Issue #219 — detail forms must not be bound to a frozen Apollo response.
 *
 * WHY THIS EXISTS
 *   Apollo Client v4 deep-freezes query results. Four detail components passed the result
 *   straight through `normalizeData(data) { return data; }` and bound it as the Formly
 *   `model`. Formly writes every keystroke (and its own defaults on first build) into that
 *   model, so each write threw `TypeError: Cannot assign to read only property '<field>'` —
 *   5-6 console errors just from opening an organisation or parent-donor record on UAT.
 *   Saving still worked (it reads `form.value`), which is why nobody noticed; but the
 *   invalid-form path does `this.model['showErrorState'] = true`, which threw instead of
 *   showing the validation state.
 *
 *   Fix: `normalizeData` returns a shallow copy (every bound key is a top-level scalar).
 *   See also [[project_apollo_v4_freeze]] and the `dashboard-architecture-contract` skill.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { test, expect, Page, Route } from '@playwright/test';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const WRITE_PERMISSIONS = [
  'read:organisations', 'write:organisations',
  'read:donorParents', 'write:donorParents',
  'read:content', 'write:content',
];
const READ_ONLY = /Cannot assign to read only property|object is not extensible/i;

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

interface DetailCase {
  name: string;
  path: string;
  query: string;
  data: Record<string, unknown>;
  /** Label of a required text field that is bound to the model. */
  field: string;
  value: string;
  /** Whether clearing `field` and submitting exercises the showErrorState path. */
  hasInvalidPath: boolean;
  /** Tab that holds the form, when it is not the first one. */
  tab?: string;
}

const CASES: DetailCase[] = [
  {
    name: 'referring-organisation-info',
    path: '/dashboard/referring-organisations/901',
    query: 'findReferringOrganisation',
    data: {
      referringOrganisation: {
        id: 901, name: 'FROZEN-ORG', phoneNumber: '07700900000', website: 'example.org', archived: false,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    field: 'Name',
    value: 'FROZEN-ORG',
    hasInvalidPath: true,
  },
  {
    name: 'donor-parent-info',
    path: '/dashboard/donor-parents/902',
    query: 'findDonorParent',
    data: {
      donorParent: {
        id: 902, name: 'FROZEN-PARENT', address: '', website: '', type: 'BUSINESS', donorCount: 0, archived: false,
        donors: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    field: 'Name',
    value: 'FROZEN-PARENT',
    hasInvalidPath: true,
  },
  {
    name: 'post-info',
    path: '/dashboard/posts/903',
    query: 'findPost',
    data: {
      post: {
        id: 903, title: 'FROZEN-POST', slug: 'frozen-post', secured: false, content: '<p>x</p>', published: true,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    field: 'Title',
    value: 'FROZEN-POST',
    hasInvalidPath: false,
    tab: 'Edit',
  },
];

async function installMocks(page: Page, c: DetailCase, mutations: string[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (/"query":"\s*mutation|"query":"\\n\s*mutation/.test(body)) {
      mutations.push(body.slice(0, 120));
      return fulfill(route, {});
    }
    if (body.includes(c.query)) return fulfill(route, c.data);
    return fulfill(route, {});
  });
}

test.describe('detail forms are not bound to frozen Apollo objects (#219) @mocked', () => {
  for (const c of CASES) {
    test(`${c.name}: loading, typing${c.hasInvalidPath ? ' and an invalid submit' : ''} throw no read-only errors`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors: string[] = [];
      page.on('pageerror', e => { if (READ_ONLY.test(e.message)) errors.push(e.message); });
      page.on('console', m => { if (m.type() === 'error' && READ_ONLY.test(m.text())) errors.push(m.text().split('\n')[0]); });
      const mutations: string[] = [];
      await installMocks(page, c, mutations);
      // CI's fake token has `permissions: []`, which renders these forms disabled.
      await authenticateWithPermissions(page, WRITE_PERMISSIONS);

      await page.goto(c.path);
      if (c.tab) await page.getByRole('tab', { name: c.tab }).click();
      const input = page.locator('formly-form').first().getByLabel(c.field).first();
      await expect(input).toHaveValue(c.value, { timeout: 30_000 });

      await input.click();
      await input.press('End');
      await page.keyboard.type('-edited');
      await expect(input).toHaveValue(`${c.value}-edited`);

      if (c.hasInvalidPath) {
        // Required field emptied, then submitted: must reach showErrorState, not throw.
        await input.fill('');
        await input.press('Enter');
        await page.waitForTimeout(500);
        expect(mutations, 'an invalid form must not be saved').toEqual([]);
      }

      await page.waitForTimeout(300);
      expect(errors, 'writes into a frozen Apollo object').toEqual([]);
    });
  }
});
