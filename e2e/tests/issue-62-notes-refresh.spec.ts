/**
 * Issue #62: the notes list must refresh in place after a note is added or
 * deleted, instead of a full-page `location.reload()` (kit-info,
 * device-request-info, referring-organisation-contact-info).
 *
 * Red signal: `window.__marker` is set before the action. A page reload wipes
 * it, an in-place refresh keeps it. Notes are append-only server rows, so the
 * mock keeps a mutable list: save appends a Note, deleteNote removes one.
 * Fully mocked, no live API.
 */
import { test, expect } from '../helpers/csp';
import type { Page } from '@playwright/test';

interface Note { id: string; content: string; volunteer: string; createdAt: string; updatedAt: string }

const note = (id: number, content: string): Note => ({
  id: String(id), content, volunteer: 'Tester',
  createdAt: '2026-01-0' + id + 'T10:00:00Z', updatedAt: '2026-01-0' + id + 'T10:00:00Z',
});

const KIT = {
  id: 2129, type: 'LAPTOP', status: 'PROCESSING_OS_INSTALLED', model: 'T480', location: 'BANK',
  createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', age: 5, archived: false,
  make: 'Lenovo', deviceVersion: null, serialNo: 'SN-2129', storageCapacity: 256, typeOfStorage: 'SSD',
  ramCapacity: 16, cpuType: 'i7', cpuCores: 4, tpmVersion: '2.0', batteryHealth: 85, lotId: null,
  locationCode: 'A1', donor: null, deviceRequest: null,
  subStatus: {
    installationOfOSFailed: false, wipeFailed: false, needsSparePart: false,
    needsFurtherInvestigation: false, network: null, installedOSName: ['WINDOWS_11'], lockedToUser: false,
  },
};

const DEVICE_REQUEST = {
  id: 77, status: 'REQUEST_NEW', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  collectionDate: null, collectionMethod: null, collectionContactName: null,
  deviceRequestItems: { phones: 0, tablets: 0, laptops: 1, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
  referringOrganisationContact: { id: 5, fullName: 'Ref Person', referringOrganisation: { id: 3, name: 'Org' } },
  isSales: false, isPrepped: false, clientRef: 'C1', details: 'd', borough: null, kits: [],
  deviceRequestNeeds: { hasInternet: false, hasMobilityIssues: false, needQuickStart: false },
};

const REFEREE = {
  id: 5, fullName: 'Ref Person', email: 'r@example.org', phoneNumber: '07000000000', address: '1 Road',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false,
  referringOrganisation: { id: 3, name: 'Org' },
};

interface Spec {
  name: string;
  url: string;
  findOp: string;
  findField: string;
  updateOp: string;
  notesProp: string;
  base: any;
}

const SPECS: Spec[] = [
  { name: 'kit-info', url: '/dashboard/devices/2129', findOp: 'findKit', findField: 'kit',
    updateOp: 'updateKit', notesProp: 'notes', base: KIT },
  { name: 'device-request-info', url: '/dashboard/device-requests/77', findOp: 'findDeviceRequest',
    findField: 'deviceRequest', updateOp: 'updateDeviceRequest', notesProp: 'deviceRequestNotes', base: DEVICE_REQUEST },
  { name: 'referring-organisation-contact-info', url: '/dashboard/referring-organisation-contacts/5',
    findOp: 'findReferringOrganisationContact', findField: 'referringOrganisationContact',
    updateOp: 'updateReferringOrganisationContact', notesProp: 'notes', base: REFEREE },
];

async function install(page: Page, s: Spec, notes: Note[]) {
  const json = (data: any) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return route.fulfill(json({ buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } }));
    }
    if (body.includes('deleteNote')) {
      const id = JSON.parse(body).variables.id;
      const i = notes.findIndex(n => n.id === String(id));
      if (i >= 0) notes.splice(i, 1);
      return route.fulfill(json({ deleteNote: true }));
    }
    if (body.includes('mutation') && body.includes(s.updateOp)) {
      const sent = JSON.parse(body).variables?.data ?? {};
      const text = (sent.note ?? sent.deviceRequestNote)?.content;
      if (text) notes.push(note(notes.length + 5, text));
      return route.fulfill(json({ [s.updateOp]: { ...s.base, [s.notesProp]: [...notes] } }));
    }
    if (body.includes(s.findOp)) {
      return route.fulfill(json({ [s.findField]: { ...s.base, [s.notesProp]: [...notes] } }));
    }
    return route.fulfill(json({}));
  });
}

for (const s of SPECS) {
  test.describe(`${s.name} notes refresh in place (#62) @mocked`, () => {
    test('adding a note shows it without a page reload', async ({ page }) => {
      test.setTimeout(60_000);
      const notes = [note(1, 'First note')];
      await install(page, s, notes);
      await page.goto(s.url);
      await expect(page.locator('.notes-list')).toContainText('First note', { timeout: 30_000 });
      await page.evaluate(() => ((window as any).__marker = 'alive'));

      await page.locator('.note-new textarea').fill('Brand new note');
      await page.locator('button:has-text("Save")').first().click();

      await expect(page.locator('.notes-list')).toContainText('Brand new note', { timeout: 10_000 });
      await expect(page.locator('.notes-list')).toContainText('First note');
      expect(await page.evaluate(() => (window as any).__marker)).toBe('alive');
    });

    // Delete is exercised on every component: that is where location.reload() lived.
    test('deleting a note removes it without a page reload', async ({ page }) => {
      test.setTimeout(60_000);
      const notes = [note(1, 'Keep me'), note(2, 'Delete me')];
      await install(page, s, notes);
      await page.goto(s.url);
      await expect(page.locator('.notes-list')).toContainText('Delete me', { timeout: 30_000 });
      await page.evaluate(() => ((window as any).__marker = 'alive'));

      const item = page.locator('.note-item').filter({ hasText: 'Delete me' });
      await item.locator('button[title="Delete"]').click();
      await page.locator('ngb-modal-window button:has-text("YES, DELETE")').click();

      await expect(page.locator('.notes-list')).not.toContainText('Delete me', { timeout: 10_000 });
      await expect(page.locator('.notes-list')).toContainText('Keep me');
      expect(await page.evaluate(() => (window as any).__marker)).toBe('alive');
    });
  });
}
