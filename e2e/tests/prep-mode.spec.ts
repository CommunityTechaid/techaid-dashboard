/**
 * Mocked regression cover for the device prep-mode prototype
 * (CommunityTechaid/techaid-server#69, stage 3).
 *
 * Fully page.route-mocked — same style as kit-resetonhide.spec.ts /
 * donor-onpush.spec.ts, no live UAT dependency. Every scan is simulated the way
 * a real keyboard-wedge scanner drives the page: fill the scan input, press
 * Enter (scan-input.component.ts's `(keydown.enter)="onEnter(field)"`).
 *
 * The COMPLETE test is the important one: `PrepApiService.markPrepped` sends a
 * FULL-REPLACE `updateDeviceRequest` payload (architecture contract §10 — any
 * omitted field is cleared server-side). This test pins the full field surface
 * so a future refactor that trims the payload fails red instead of silently
 * clearing fields like `deviceRequestNote` or `collectionDate` in production.
 */
import { test, expect, Page, Route } from '@playwright/test';

interface MockRequest {
  id: string;
  status: string;
  isPrepped: boolean;
  isSales: boolean;
  clientRef: string;
  borough: string;
  details: string;
  collectionDate: string | null;
  collectionMethod: string | null;
  collectionContactName: string | null;
  deviceRequestItems: Record<string, number>;
  referringOrganisationContact: { id: string; fullName: string; referringOrganisation: { id: string; name: string } } | null;
  kits: { id: string; type: string; make?: string; model?: string; status?: string }[];
  deviceRequestNotes: unknown[];
}

const ITEMS = (overrides: Partial<Record<string, number>> = {}) => ({
  laptops: 2,
  phones: 1,
  tablets: 0,
  allInOnes: 0,
  desktops: 0,
  commsDevices: 0,
  other: 0,
  broadbandHubs: 0,
  ...overrides,
});

function queueItem(id: number, details: Partial<MockRequest> = {}): any {
  return {
    id: String(id),
    collectionDate: '2026-07-20T10:00:00.000Z',
    isPrepped: false,
    clientRef: `REF-${id}`,
    referringOrganisationContact: {
      id: '1',
      fullName: 'Jane Referee',
      referringOrganisation: { id: '1', name: 'Org A' },
    },
    deviceRequestItems: ITEMS(),
    ...details,
  };
}

function requestFixture(id: number, overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    id: String(id),
    status: 'NEW',
    isPrepped: false,
    isSales: false,
    clientRef: `REF-${id}`,
    borough: 'Lambeth',
    details: `Notes for request ${id}`,
    collectionDate: '2026-07-20T10:00:00.000Z',
    collectionMethod: 'COLLECTION',
    collectionContactName: 'Jane Doe',
    deviceRequestItems: ITEMS(),
    referringOrganisationContact: {
      id: '1',
      fullName: 'Jane Referee',
      referringOrganisation: { id: '1', name: 'Org A' },
    },
    kits: [],
    deviceRequestNotes: [],
    ...overrides,
  };
}

interface MockOpts {
  queueItems: any[];
  requests: Record<string, MockRequest>;
  kits?: Record<string, { id: string; type: string; make?: string; model?: string; status?: string }>;
  capturedAssign?: any[];
  capturedUpdate?: any[];
}

async function installMocks(page: Page, opts: MockOpts): Promise<void> {
  const kits = opts.kits ?? {};
  const capturedAssign = opts.capturedAssign ?? [];
  const capturedUpdate = opts.capturedUpdate ?? [];

  await page.route('**/graphql', async (route: Route) => {
    const body = route.request().postData() ?? '';
    let parsed: any = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* ignore */
    }

    const reply = (data: any) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (body.includes('buildInfo')) {
      return reply({ buildInfo: { version: '1.0.0-test', commit: 'abc123', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('prepQueue')) {
      return reply({
        deviceRequestConnection: { totalElements: opts.queueItems.length, content: opts.queueItems },
      });
    }
    if (body.includes('prepKit')) {
      const id = String(parsed?.variables?.id);
      return reply({ kit: kits[id] ?? null });
    }
    if (body.includes('assignKitsToDeviceRequest')) {
      const data = parsed?.variables?.data ?? {};
      capturedAssign.push(parsed);
      const reqId = String(data.deviceRequestId);
      const kitId = String((data.kitIds ?? [])[0]);
      const req = opts.requests[reqId];
      const kitFixture = kits[kitId];
      if (req && kitFixture) {
        req.kits = [...req.kits, { id: kitId, type: kitFixture.type, make: kitFixture.make, model: kitFixture.model, status: kitFixture.status }];
      }
      return reply({
        assignKitsToDeviceRequest: { id: reqId, kits: (req?.kits ?? []).map((k) => ({ id: k.id })) },
      });
    }
    if (body.includes('updateDeviceRequest')) {
      capturedUpdate.push(parsed);
      const data = parsed?.variables?.data ?? {};
      const reqId = String(data.id);
      if (opts.requests[reqId]) {
        opts.requests[reqId] = { ...opts.requests[reqId], isPrepped: !!data.isPrepped };
      }
      return reply({ updateDeviceRequest: { id: reqId, isPrepped: !!data.isPrepped } });
    }
    if (body.includes('prepRequest')) {
      const id = String(parsed?.variables?.id);
      return reply({ deviceRequest: opts.requests[id] ?? null });
    }
    return reply({});
  });
}

async function startQueue(page: Page): Promise<void> {
  await page.goto('/dashboard/prep-mode');
  await page.locator('#prep-date').fill('2026-07-20');
  await page.getByRole('button', { name: 'Start prepping' }).click();
}

function scanInput(page: Page) {
  return page.getByTestId('scan-input-field');
}

async function scan(page: Page, raw: string): Promise<void> {
  const input = scanInput(page);
  await input.fill(raw);
  await input.press('Enter');
}

test.describe('prep-mode queue and scan flow @mocked', () => {
  test('queue load: notes, requested counts and position render for the first request', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      queueItems: [queueItem(501), queueItem(502)],
      requests: {
        '501': requestFixture(501, { details: 'Needs adapter cable' }),
        '502': requestFixture(502, { details: 'Second request notes' }),
      },
    });

    await startQueue(page);

    await expect(page.getByText('Request 1 of 2')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Needs adapter cable')).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Laptops' })).toContainText('0/2');
    await expect(page.locator('tr', { hasText: 'Phones' })).toContainText('0/1');
  });

  test('scan a kit id assigns it and refetches updated assigned counts', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedAssign: any[] = [];
    await installMocks(page, {
      queueItems: [queueItem(501)],
      requests: { '501': requestFixture(501) },
      kits: { '9001': { id: '9001', type: 'LAPTOP', make: 'Dell', model: 'Latitude 5490', status: 'IN_STOCK' } },
      capturedAssign,
    });

    await startQueue(page);
    await expect(page.getByText('Request 1 of 1')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tr', { hasText: 'Laptops' })).toContainText('0/2');

    await scan(page, '9001');

    await expect.poll(() => capturedAssign.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const data = capturedAssign[0]?.variables?.data;
    expect(data.deviceRequestId).toBe(501);
    expect(data.kitIds).toEqual(['9001']);

    await expect(page.locator('tr', { hasText: 'Laptops' })).toContainText('1/2', { timeout: 10_000 });
    await expect(page.locator('.list-group-item', { hasText: '#9001' })).toBeVisible();
  });

  test('CTA*COMPLETE sends a full-replace updateDeviceRequest payload and advances', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdate: any[] = [];
    await installMocks(page, {
      queueItems: [queueItem(501), queueItem(502)],
      requests: {
        '501': requestFixture(501),
        '502': requestFixture(502),
      },
      capturedUpdate,
    });

    await startQueue(page);
    await expect(page.getByText('Request 1 of 2')).toBeVisible({ timeout: 15_000 });

    await scan(page, 'CTA*COMPLETE');

    await expect.poll(() => capturedUpdate.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const data = capturedUpdate[0]?.variables?.data;

    // The critical regression pin: isPrepped must flip true AND every field
    // device-request-info's normal save sends must still be present — an
    // omitted field is silently cleared server-side (full-replace mutation).
    expect(data.isPrepped).toBe(true);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('clientRef');
    expect(data).toHaveProperty('borough');
    expect(data).toHaveProperty('details');
    expect(data).toHaveProperty('deviceRequestItems');
    expect(data.deviceRequestItems).toMatchObject({
      laptops: expect.any(Number),
      phones: expect.any(Number),
      tablets: expect.any(Number),
      allInOnes: expect.any(Number),
      desktops: expect.any(Number),
      commsDevices: expect.any(Number),
      broadbandHubs: expect.any(Number),
      other: expect.any(Number),
    });
    expect(data).toHaveProperty('referringOrganisationContactId');
    expect(data).toHaveProperty('collectionDate');
    expect(data).toHaveProperty('collectionMethod');
    expect(data).toHaveProperty('collectionContactName');
    expect(data).toHaveProperty('deviceRequestNote');
    expect(data.deviceRequestNote).toEqual({ content: '' });
    expect(data).toHaveProperty('isSales');

    // Auto-advance to the next request in the queue.
    await expect(page.getByText('Request 2 of 2')).toBeVisible({ timeout: 10_000 });
  });

  test('CTA*SKIP advances without any updateDeviceRequest call', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedUpdate: any[] = [];
    await installMocks(page, {
      queueItems: [queueItem(501), queueItem(502)],
      requests: {
        '501': requestFixture(501),
        '502': requestFixture(502),
      },
      capturedUpdate,
    });

    await startQueue(page);
    await expect(page.getByText('Request 1 of 2')).toBeVisible({ timeout: 15_000 });

    await scan(page, 'CTA*SKIP');

    await expect(page.getByText('Request 2 of 2')).toBeVisible({ timeout: 10_000 });
    expect(capturedUpdate.length).toBe(0);
  });

  test('unknown scan shows a non-blocking error and triggers no mutation', async ({ page }) => {
    test.setTimeout(60_000);
    const capturedAssign: any[] = [];
    const capturedUpdate: any[] = [];
    await installMocks(page, {
      queueItems: [queueItem(501)],
      requests: { '501': requestFixture(501) },
      capturedAssign,
      capturedUpdate,
    });

    await startQueue(page);
    await expect(page.getByText('Request 1 of 1')).toBeVisible({ timeout: 15_000 });

    await scan(page, 'ZZZ-!!');

    await expect(page.getByText('Unrecognised scan: "ZZZ-!!".')).toBeVisible({ timeout: 10_000 });
    // Still on the same request — an unknown scan must not advance the queue.
    await expect(page.getByText('Request 1 of 1')).toBeVisible();
    expect(capturedAssign.length).toBe(0);
    expect(capturedUpdate.length).toBe(0);
  });
});
