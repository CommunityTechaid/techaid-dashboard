/**
 * Native tables (#113, milestone 2) — the two audit tabs are plain signal lists now.
 *
 * kit-audit-component and device-request-audit-component used DataTables only as a loader
 * (paging, ordering, searching and info all off). They now hold their rows in signals, so these
 * specs pin what the pages must still do: render the revisions, label "System", say "No data!"
 * only after the first answer, hide and re-show automated rewrites (kit), and warn on a failed request. Because the lists are signal-driven and
 * OnPush they repaint without zone.js (#115).
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { STAFF_PERMISSIONS, loginWith } from '../helpers/auth0-cache';

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const KIT = {
  id: 7, type: 'LAPTOP', status: 'DONATION_NEW', model: 'AUDIT-KIT', location: 'Brixton', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', age: 1, archived: false, make: 'Dell', deviceVersion: null, serialNo: 'SN1',
  storageCapacity: null, typeOfStorage: null, ramCapacity: null, cpuType: null, cpuCores: null, tpmVersion: null,
  batteryHealth: null, lotId: null, locationCode: null, donor: null, deviceRequest: null, notes: [],
  subStatus: { installationOfOSFailed: false, wipeFailed: false, needsSparePart: false, needsFurtherInvestigation: false, network: false, installedOSName: null, lockedToUser: false },
};

const DR = {
  id: 9, status: 'NEW', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', collectionDate: null,
  collectionMethod: null, collectionContactName: null,
  deviceRequestItems: { phones: 0, tablets: 0, laptops: 2, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
  referringOrganisationContact: { id: 1, fullName: 'Referee', referringOrganisation: { id: 1, name: 'Org' } },
  isSales: false, isPrepped: false, clientRef: 'AUDIT-DR', details: '', borough: '', kits: [],
  deviceRequestNeeds: { hasInternet: true, hasMobilityIssues: false, needQuickStart: false },
  deviceRequestNotes: [],
};

const sub = (over = {}) => ({ installationOfOSFailed: false, wipeFailed: false, needsSparePart: false, needsFurtherInvestigation: false, network: false, installedOSName: null, lockedToUser: false, ...over });
const kitAudit = (id: number, who: string, collateral: boolean, model: string) => ({
  changedNothingAudited: collateral, siblingKitsInRevision: collateral ? 3 : 0,
  revision: { id, timestamp: '2026-01-02T10:00:00Z', customUser: who }, type: 'MOD',
  entity: { model, status: 'DONATION_NEW', serialNo: `SN-${id}`, updatedAt: '2026-01-02T10:00:00Z', createdAt: '2026-01-01T00:00:00Z', subStatus: sub({ wipeFailed: id === 101 }) },
});

interface Opts { kitAudits?: unknown[]; drAudits?: unknown[]; fail?: 'kit' | 'dr'; delay?: number }

async function installMocks(page: Page, opts: Opts = {}): Promise<{ kitCalls: () => number; drCalls: () => number }> {
  let kit = 0;
  let dr = 0;
  // The Audit tabs need admin:kits / admin:organisations on top of the staff set.
  await loginWith(page, [...STAFF_PERMISSIONS, 'admin:kits', 'admin:organisations']);
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('getAuditTrail')) {
      kit++;
      if (opts.delay) await new Promise(r => setTimeout(r, opts.delay));
      if (opts.fail === 'kit') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'boom' }] }) });
      return fulfill(route, { kitAudits: opts.kitAudits ?? [] });
    }
    if (body.includes('getDeviceRequestAuditTrail')) {
      dr++;
      if (opts.fail === 'dr') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'boom' }] }) });
      return fulfill(route, { deviceRequestAudits: opts.drAudits ?? [] });
    }
    if (body.includes('findKit')) return fulfill(route, { kit: KIT });
    if (body.includes('findDeviceRequest')) return fulfill(route, { deviceRequest: DR });
    return fulfill(route, {});
  });
  return { kitCalls: () => kit, drCalls: () => dr };
}

test.describe('audit tabs without DataTables @mocked', () => {
  test('kit audit: revisions render, "System" label, no DataTables chrome, collateral hide/show', async ({ page }) => {
    await installMocks(page, {
      kitAudits: [
        kitAudit(101, 'u1|Alice', false, 'Real edit'),
        kitAudit(102, '|', false, 'Automated'),
        kitAudit(103, 'u2|Bob', true, 'Collateral A'),
        kitAudit(104, 'u2|Bob', true, 'Collateral B'),
      ],
    });
    await page.goto('/dashboard/devices/7');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    const table = page.locator('table#kit-audit-7');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('Alice');
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('System');
    await expect(rows.nth(0).locator('input[type=checkbox]').nth(1)).toBeChecked(); // wipe failed
    await expect(page.locator('#kit-audit-7_wrapper')).toHaveCount(0);
    await expect(page.locator('kit-audit-component td.no-data-available')).toHaveCount(0);

    await expect(page.locator('kit-audit-component .alert')).toContainText('2 automated rewrites hidden');
    await page.locator('kit-audit-component .alert button').click();
    await expect(rows).toHaveCount(4);
    await expect(page.locator('kit-audit-component .alert')).toContainText('shown below');
    await page.locator('kit-audit-component .alert button').click();
    await expect(rows).toHaveCount(2);
  });

  test('kit audit: "No data!" only after the first answer, then for an empty history', async ({ page }) => {
    await installMocks(page, { kitAudits: [], delay: 800 });
    await page.goto('/dashboard/devices/7');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    await expect(page.locator('table#kit-audit-7')).toBeVisible();
    await expect(page.locator('kit-audit-component td.no-data-available')).toHaveCount(0);
    await expect(page.locator('kit-audit-component td.no-data-available')).toHaveText('No data!');
  });

  test('kit audit: a failed request warns and shows "No data!"', async ({ page }) => {
    await installMocks(page, { fail: 'kit' });
    await page.goto('/dashboard/devices/7');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error');
    await expect(page.locator('kit-audit-component td.no-data-available')).toHaveText('No data!');
  });

  test('device request audit: rows render and the Who column falls back to System', async ({ page }) => {
    await installMocks(page, {
      drAudits: [
        { revision: { id: 5, timestamp: '2026-01-02T10:00:00Z', customUser: 'u1|Alice' }, type: 'MOD', entity: { ...DR, deviceRequestItems: DR.deviceRequestItems } },
        { revision: { id: 6, timestamp: '2026-01-03T10:00:00Z', customUser: '|' }, type: 'MOD', entity: { ...DR, clientRef: 'SECOND', isSales: true } },
      ],
    });
    await page.goto('/dashboard/device-requests/9');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    const rows = page.locator('table#device-request-audit-9 tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('Alice');
    await expect(rows.nth(1).locator('td').nth(2)).toHaveText('System');
    await expect(rows.nth(1).locator('td').nth(4)).toHaveText('SECOND');
    await expect(rows.nth(0).locator('td').nth(6)).toHaveText('2'); // laptops
    await expect(page.locator('#device-request-audit-9_wrapper')).toHaveCount(0);
  });

  test('device request audit: empty history says "No data!" and a failure warns', async ({ page }) => {
    await installMocks(page, { drAudits: [] });
    await page.goto('/dashboard/device-requests/9');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    await expect(page.locator('device-request-audit-component td.no-data-available')).toHaveText('No data!');
    await page.unroute('**/graphql');
    await installMocks(page, { fail: 'dr' });
    await page.goto('/dashboard/device-requests/9');
    await page.locator('ul.nav-tabs .nav-link', { hasText: 'Audit Table' }).click();
    await expect(page.locator('.toast-warning')).toContainText('GraphQL Error');
  });
});
