/**
 * Issue #233 (phase 1) — request / referee pages accept `write:requests` / `write:referees`
 * as well as the legacy `write:organisations`; the organisation page stays organisations-only.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; fake JWTs carry the permission sets.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { authenticateWithPermissions } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';

const DATA: Record<string, unknown> = {
  findDeviceRequest: {
    deviceRequest: {
      id: 911, status: 'NEW', createdAt: TS, updatedAt: TS, collectionDate: null, collectionMethod: null,
      collectionContactName: 'PERM-CONTACT', deviceRequestItems: null, referringOrganisationContact: null,
      isSales: false, isPrepped: false, clientRef: '', details: '', borough: '', kits: [],
      deviceRequestNeeds: null, deviceRequestNotes: [],
    },
  },
  findReferringOrganisationContact: {
    referringOrganisationContact: {
      id: 912, fullName: 'PERM-REFEREE', email: 'a@example.org', phoneNumber: '07700900000', address: '',
      createdAt: TS, updatedAt: TS, archived: false, notes: [],
      referringOrganisation: { id: 913, name: 'PERM-ORG' },
    },
  },
  findReferringOrganisation: {
    referringOrganisation: {
      id: 913, name: 'PERM-ORG', phoneNumber: '07700900000', website: 'example.org', archived: false,
      createdAt: TS, updatedAt: TS,
    },
  },
};

const PAGES = [
  { name: 'referee page', path: '/dashboard/referring-organisation-contacts/912', field: 'Full Name', value: 'PERM-REFEREE' },
  { name: 'organisation page', path: '/dashboard/referring-organisations/913', field: 'Name', value: 'PERM-ORG' },
  { name: 'request page', path: '/dashboard/device-requests/911', field: 'Contact Name', value: 'PERM-CONTACT' },
];

// expected editable: [referee, organisation, request]
const SCENARIOS: { perms: string[]; editable: boolean[] }[] = [
  { perms: ['write:requests'], editable: [false, false, true] },
  { perms: ['write:organisations'], editable: [true, true, true] },
  { perms: ['write:referees'], editable: [true, false, false] },
  // read-only user (read:organisations is in the base set): nothing editable (#287)
  { perms: [], editable: [false, false, false] },
];

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, seen?: string[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    seen?.push(body);
    if (body.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    }
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    for (const [op, data] of Object.entries(DATA)) {
      if (body.includes(`query ${op}`)) return fulfill(route, data);
    }
    return fulfill(route, {});
  });
}

test.describe('split write permissions (#233) @mocked', () => {
  for (const s of SCENARIOS) {
    PAGES.forEach((p, i) => {
      test(`[${s.perms}] ${p.name} is ${s.editable[i] ? 'editable' : 'read-only'}`, async ({ page }) => {
        test.setTimeout(60_000);
        await installMocks(page);
        await authenticateWithPermissions(page, ['read:organisations', 'read:requests', 'read:referees', 'app:bulkedit', ...s.perms]);
        await page.goto(p.path);
        const input = page.locator('formly-form').first().getByLabel(p.field).first();
        await expect(input).toHaveValue(p.value, { timeout: 30_000 });
        if (s.editable[i]) await expect(input).toBeEnabled();
        else await expect(input).toBeDisabled();
        if (p.name === 'request page') {
          // Save / assign actions follow the same permission (#287); Generate PDF is read-only so stays.
          const actions = page.locator('[data-testid="devreq-save"], [data-testid="devreq-assign-open"]');
          if (s.editable[i]) await expect(actions).toHaveCount(2);
          else await expect(actions).toHaveCount(0);
          await expect(page.getByRole('button', { name: /Generate PDF/ })).toBeVisible();
        }
      });
    });
  }

  // ---- #288: read + delete gating (accept old OR new) ----
  const DELETE_BTN = (page: Page) => page.locator('button', { hasText: /^\s*DELETE\s*$/ });
  const BASE = ['app:bulkedit', 'read:kits']; // deliberately NO read:organisations/requests/referees

  // expected delete visible: [referee, organisation, request]
  const DELETE_SCENARIOS: { perms: string[]; visible: boolean[] }[] = [
    { perms: ['delete:requests'], visible: [false, false, true] },
    { perms: ['delete:referees'], visible: [true, false, false] },
    { perms: ['delete:organisations'], visible: [true, true, true] },
    { perms: [], visible: [false, false, false] },
  ];
  for (const s of DELETE_SCENARIOS) {
    PAGES.forEach((p, i) => {
      test(`[${s.perms}] delete button on ${p.name} is ${s.visible[i] ? 'shown' : 'hidden'} (#288)`, async ({ page }) => {
        test.setTimeout(60_000);
        await installMocks(page);
        await authenticateWithPermissions(page, ['read:organisations', ...s.perms, 'app:bulkedit']);
        await page.goto(p.path);
        await expect(page.locator('formly-form').first().getByLabel(p.field).first()).toHaveValue(p.value, { timeout: 30_000 });
        await expect(DELETE_BTN(page)).toHaveCount(s.visible[i] ? 1 : 0);
      });
    });
  }

  // expected menu entries: [Orgs, Referees, Requests, Distributions & Deliveries]
  const MENU = ['Orgs', 'Referees', 'Requests', 'Distributions & Deliveries'];
  const MENU_SCENARIOS: { perms: string[]; shown: boolean[] }[] = [
    { perms: ['read:requests'], shown: [false, false, true, true] },
    { perms: ['read:referees'], shown: [false, true, false, false] },
    { perms: ['read:organisations'], shown: [true, true, true, true] },
    { perms: [], shown: [false, false, false, false] },
  ];
  for (const s of MENU_SCENARIOS) {
    test(`[${s.perms}] sidebar entries (#288)`, async ({ page }) => {
      test.setTimeout(60_000);
      await installMocks(page);
      await authenticateWithPermissions(page, [...BASE, ...s.perms]);
      await page.goto('/dashboard/devices');
      const nav = page.locator('app-sidebar, .sidebar').first();
      await expect(nav.locator('.nav-link span', { hasText: /^Devices/ }).first()).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < MENU.length; i++) {
        await expect(nav.getByText(MENU[i], { exact: true }))
          .toHaveCount(s.shown[i] ? 1 : 0);
      }
    });
  }

  // Maintainer decision: read:requests-only users must not trigger the server-denied referee `notes` field.
  test('request page query never asks for referee notes (#288)', async ({ page }) => {
    test.setTimeout(60_000);
    const seen: string[] = [];
    await installMocks(page, seen);
    await authenticateWithPermissions(page, [...BASE, 'read:requests']);
    await page.goto('/dashboard/device-requests/911');
    await expect(page.locator('formly-form').first().getByLabel('Contact Name').first()).toHaveValue('PERM-CONTACT', { timeout: 30_000 });
    const reqQueries = seen.filter(b => b.includes('query findDeviceRequest'));
    expect(reqQueries.length).toBeGreaterThan(0);
    for (const q of reqQueries) expect(q).not.toMatch(/notes/);
  });

  // org-request's isOrgAdmin is covered by review only.
});
