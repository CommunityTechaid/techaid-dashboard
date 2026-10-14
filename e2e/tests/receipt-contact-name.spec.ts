/**
 * Delivery receipt "Contact Name" line.
 *
 * When a request has no collectionContactName, the receipt falls back to the
 * referee's name. The receipt template already prints "Contact Name:" before
 * the value, so the fallback must be the bare name — the old "Referee: "
 * prefix rendered as "Contact Name: Referee: Steve Woolnough" (reported from UAT
 * testing on request 3214).
 */
import { test, expect } from '@playwright/test';

async function fulfillSimple(route: import('@playwright/test').Route, data: any) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

function deviceRequest(collectionContactName: string | null) {
  return {
    id: 3214,
    status: 'NEW',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    collectionDate: '2026-10-20T12:00:00Z',
    collectionMethod: 'COLLECTION',
    collectionContactName,
    deviceRequestItems: { phones: 0, tablets: 0, laptops: 1, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
    referringOrganisationContact: {
      id: 1,
      fullName: 'Steve Woolnough',
      email: 'referee@example.org',
      phoneNumber: '',
      referringOrganisation: { id: 1, name: 'Community TechAid' },
    },
    isSales: false,
    isPrepped: false,
    clientRef: 'xyz',
    details: '',
    borough: '',
    kits: [],
    deviceRequestNeeds: { hasInternet: false, hasMobilityIssues: false, needQuickStart: false },
    deviceRequestNotes: [],
  };
}

async function captureReceiptPayload(page: import('@playwright/test').Page, collectionContactName: string | null) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return fulfillSimple(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('findDeviceRequest')) {
      return fulfillSimple(route, { deviceRequest: deviceRequest(collectionContactName) });
    }
    if (body.includes('countDevicesForRequest')) {
      return fulfillSimple(route, { kitsConnection: { totalElements: 0 } });
    }
    return fulfillSimple(route, {});
  });

  let payload: any = null;
  // Stub the Apps Script receipt generator. success:false keeps the test from
  // opening a popup with the generated PDF.
  await page.route('https://script.google.com/**', async route => {
    payload = JSON.parse(route.request().postData() ?? 'null');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'stubbed' }),
    });
  });

  await page.goto('/dashboard/device-requests/3214');
  await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('button:has-text("Generate PDF")').click();
  await expect.poll(() => payload, { timeout: 10_000 }).not.toBeNull();
  return payload;
}

test.describe('Delivery receipt contact name @mocked', () => {
  test('falls back to the bare referee name when no collection contact is set', async ({ page }) => {
    test.setTimeout(60_000);
    const payload = await captureReceiptPayload(page, null);
    expect(payload.collectionContactName).toBe('Steve Woolnough');
  });

  test('uses the collection contact name when one is set', async ({ page }) => {
    test.setTimeout(60_000);
    const payload = await captureReceiptPayload(page, 'Jane Doe');
    expect(payload.collectionContactName).toBe('Jane Doe');
  });
});
