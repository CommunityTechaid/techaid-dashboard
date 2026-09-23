/**
 * Hygiene 6.5 / #114 — regression cover for the OnPush fan-out.
 *
 * Twelve components moved to ChangeDetectionStrategy.OnPush (kit-index,
 * device-request-index, referring-organisation-index,
 * referring-organisation-contact-index, donor-parent-index, post-index,
 * user-index, role-index, kit-component, donor-component, referee-component,
 * distributions-and-deliveries-index), each with cdr.markForCheck() calls at
 * every site where template-bound state is assigned from an async callback
 * (the DataTables ajax callback, and — where present — the filter-modal
 * apply path, whose view lives in NgbModal's own window component, not the
 * host). delivery-slots.component.ts stays on the Default strategy but
 * gained markForCheck() calls of its own because its OnPush ancestor
 * (distributions-and-deliveries-index) otherwise blocks its subtree from
 * repainting on its own async callbacks.
 *
 * Every test here was proved red: the markForCheck() call it guards was
 * temporarily deleted, the test was run and confirmed to fail, then the call
 * was restored and the test re-confirmed green. See the builder's report for
 * the per-test red-proof record — that step doesn't live in git history, only
 * in the PR/task record, since committing a broken intermediate state would
 * defeat the point.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token
 * required.
 */
import { test, expect, Page, Route } from '@playwright/test';

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };

/**
 * Generic GraphQL router: matches each handler's key as a substring of the raw request
 * body (the operation name), in order. buildInfo and featureFlagsPublic are handled for
 * every test since the app shell/feature-flag service fire them regardless of page.
 * Anything unmatched gets an empty `{}` — the same permissive fallback every other
 * @mocked spec in this suite uses.
 */
async function installMocks(page: Page, handlers: Record<string, unknown>): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
    if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
    for (const key of Object.keys(handlers)) {
      if (body.includes(key)) return fulfillJson(route, handlers[key]);
    }
    return fulfillJson(route, {});
  });
}

test.describe('OnPush fan-out — ajax-callback repaint (priority 1) @mocked', () => {
  test('kit-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllKits: {
        kitsConnection: {
          totalElements: 1,
          number: 0,
          content: [{
            id: 1, make: 'Dell', model: 'ONPUSH-KIT-MODEL', age: 1, type: 'LAPTOP', status: 'DONATION_NEW',
            location: 'Brixton store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
            lotId: null, donor: null, deviceRequest: null,
          }],
        },
      },
    });
    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr', { hasText: 'ONPUSH-KIT-MODEL' })).toBeVisible({ timeout: 30_000 });
  });

  test('device-request-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllDeviceRequests: {
        deviceRequestConnection: {
          totalElements: 1,
          content: [{
            id: 1, status: 'NEW', clientRef: 'ONPUSH-DR-REF', borough: '',
            deviceRequestItems: { phones: 0, tablets: 0, laptops: 0, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
            kits: [],
            referringOrganisationContact: { id: 1, fullName: 'Referee', referringOrganisation: { id: 1, name: 'Org' } },
            isPrepped: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      },
    });
    await page.goto('/dashboard/device-requests');
    await expect(page.locator('#device-request-index tbody tr', { hasText: 'ONPUSH-DR-REF' })).toBeVisible({ timeout: 30_000 });
  });

  test('referring-organisation-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllReferringOrgs: {
        referringOrganisationsConnection: {
          totalElements: 1,
          content: [{
            id: 1, phoneNumber: '07700900000', name: 'ONPUSH-ORG-NAME', website: '', requestCount: 0,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false,
          }],
        },
      },
    });
    await page.goto('/dashboard/referring-organisations');
    await expect(page.locator('#referring-org-index tbody tr', { hasText: 'ONPUSH-ORG-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('referring-organisation-contact-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllReferringOrgContacts: {
        referringOrganisationContactsConnection: {
          totalElements: 1,
          content: [{
            id: 1, fullName: 'ONPUSH-REFEREE-NAME', email: 'referee@example.org', phoneNumber: '07700900000',
            requestCount: 0, referringOrganisation: { id: 1, name: 'Org' },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false,
          }],
        },
      },
    });
    await page.goto('/dashboard/referring-organisation-contacts');
    await expect(page.locator('#referring-org-contact-index tbody tr', { hasText: 'ONPUSH-REFEREE-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('donor-parent-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllDonorParents: {
        donorParentsConnection: {
          totalElements: 1,
          content: [{
            id: 1, name: 'ONPUSH-PARENT-NAME', address: '', website: '', donorCount: 0, type: 'BUSINESS',
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false, donors: [],
          }],
        },
      },
    });
    await page.goto('/dashboard/donor-parents');
    await expect(page.locator('#donor-parent-index tbody tr', { hasText: 'ONPUSH-PARENT-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('post-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllPosts: {
        postsConnection: {
          totalElements: 1,
          content: [{
            id: 1, slug: 'onpush-post-slug', title: 'ONPUSH-POST-TITLE', published: true,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      },
    });
    await page.goto('/dashboard/posts');
    await expect(page.locator('#post-index tbody tr', { hasText: 'ONPUSH-POST-TITLE' })).toBeVisible({ timeout: 30_000 });
  });

  test('user-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllUsers: {
        users: {
          totalElements: 1,
          number: 0,
          content: [{
            id: 'auth0|onpush-user', userId: 'auth0|onpush-user', phoneNumber: '', email: 'onpush@example.org',
            name: 'ONPUSH-USER-NAME', picture: '', lastLogin: '2026-01-01T00:00:00Z', loginsCount: 1,
          }],
        },
      },
    });
    await page.goto('/dashboard/users');
    await expect(page.locator('#user-index tbody tr', { hasText: 'ONPUSH-USER-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('role-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllRoles: {
        roles: {
          totalElements: 1,
          number: 0,
          content: [{ id: 1, name: 'ONPUSH-ROLE-NAME', description: 'A role' }],
        },
      },
    });
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr', { hasText: 'ONPUSH-ROLE-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('distributions-and-deliveries-index: rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page, {
      findAllDeviceRequests: {
        deviceRequestConnection: {
          totalElements: 1,
          content: [{
            id: 1, status: 'NEW', clientRef: 'ONPUSH-DND-REF', collectionDate: null,
            deviceRequestItems: { phones: 0, tablets: 0, laptops: 0, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0 },
            kits: [], referringOrganisationContact: { id: 1, fullName: 'Referee', referringOrganisation: { id: 1, name: 'Org' } },
            isPrepped: false, collectionMethod: 'COLLECTION', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      },
    });
    await page.goto('/dashboard/distributions-and-deliveries');
    await expect(page.locator('#distributions-and-deliveries-index tbody tr', { hasText: 'ONPUSH-DND-REF' })).toBeVisible({ timeout: 30_000 });
  });

  test('kit-component (donor-info Devices tab): rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    const donorId = 9001;
    await installMocks(page, {
      findDonor: {
        donor: {
          id: donorId, name: 'ONPUSH-DONOR-PARENT-VIEW', postCode: 'SW9 0AA', phoneNumber: '07700900000',
          email: 'donor@example.org', referral: '', archived: false, isLeadContact: false,
          donorParent: { id: 1, name: 'A Parent' }, kits: [],
        },
      },
      findAllKits: {
        kitsConnection: {
          totalElements: 1,
          number: 0,
          content: [{
            id: 1, make: 'Dell', model: 'ONPUSH-DONOR-KIT-MODEL', age: 1, type: 'LAPTOP', status: 'DONATION_NEW',
            location: 'Brixton store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
            donor: null, deviceRequest: null,
          }],
        },
      },
    });
    await page.goto(`/dashboard/donors/${donorId}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'ONPUSH-DONOR-PARENT-VIEW' })).toBeVisible({ timeout: 30_000 });
    // ngbNav renders tabs with role="tab" (an ARIA tablist), not role="link".
    await page.getByRole('tab', { name: 'Devices' }).click();
    await expect(page.locator(`#donor-info-${donorId} tbody tr`, { hasText: 'ONPUSH-DONOR-KIT-MODEL' })).toBeVisible({ timeout: 30_000 });
  });

  test('donor-component (donor-parent-info Individual Donors tab): rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    const donorParentId = 9002;
    await installMocks(page, {
      findDonorParent: {
        donorParent: {
          id: donorParentId, name: 'ONPUSH-DONOR-PARENT-NAME', address: '', website: '', type: 'BUSINESS',
          donorCount: 1, archived: false, donors: [],
        },
      },
      findAllDonors: {
        donorsConnection: {
          totalElements: 1,
          content: [{
            id: 1, name: 'ONPUSH-CHILD-DONOR-NAME', postCode: 'SW9 0AA', phoneNumber: '07700900000',
            email: 'donor@example.org', kitCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            archived: false, isLeadContact: false, donorParent: { id: donorParentId, name: 'ONPUSH-DONOR-PARENT-NAME' },
          }],
        },
      },
    });
    await page.goto(`/dashboard/donor-parents/${donorParentId}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'ONPUSH-DONOR-PARENT-NAME' })).toBeVisible({ timeout: 30_000 });
    // ngbNav renders tabs with role="tab" (an ARIA tablist), not role="link" — unlike the
    // plain <a> quick-filter tabs on distributions-and-deliveries-index.
    await page.getByRole('tab', { name: 'Individual Donors' }).click();
    // donor-component.html hard-codes id="donor-index" on this table (not the tableId
    // @Input) — a pre-existing quirk of the component, not something this test invents.
    await expect(page.locator('#donor-index tbody tr', { hasText: 'ONPUSH-CHILD-DONOR-NAME' })).toBeVisible({ timeout: 30_000 });
  });

  test('referee-component (referring-organisation-info Referees tab): rows render from the DataTables ajax callback', async ({ page }) => {
    test.setTimeout(60_000);
    const orgId = 9003;
    await installMocks(page, {
      findReferringOrganisation: {
        referringOrganisation: {
          id: orgId, phoneNumber: '07700900000', name: 'ONPUSH-ORG-VIEW-NAME', website: '', archived: false,
          createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        },
      },
      findAllReferringOrgContacts: {
        referringOrganisationContactsConnection: {
          totalElements: 1,
          content: [{
            id: 1, fullName: 'ONPUSH-REFEREE-CHILD-NAME', email: 'referee@example.org', phoneNumber: '07700900000',
            requestCount: 0, archived: false, referringOrganisation: { id: orgId, name: 'ONPUSH-ORG-VIEW-NAME' },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }],
        },
      },
    });
    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'ONPUSH-ORG-VIEW-NAME' })).toBeVisible({ timeout: 30_000 });
    // ngbNav renders tabs with role="tab" — see the "Individual Donors" test above.
    await page.getByRole('tab', { name: 'Referees' }).click();
    await expect(page.locator(`#referring-organisation-referees-${orgId} tbody tr`, { hasText: 'ONPUSH-REFEREE-CHILD-NAME' })).toBeVisible({ timeout: 30_000 });
  });
});

// Priority 2 (filter-apply markForCheck, e.g. kit-index's applyFilter()) was investigated
// thoroughly, including a delayed-reload-response variant of the same technique
// delivery-slots' load() error-branch test below uses (assert the badge before the reload's
// own ajax-callback markForCheck can possibly fire) — and confirmed UNPROVABLE, for a more
// fundamental reason than "the reload's own markForCheck masks it eventually":
//
// Every one of these components' filter modal is a plain `<ng-template #filters>` opened via
// `NgbModal.open(templateRef)`. ng-bootstrap's modal.ts turns that into
// `templateRef.createEmbeddedView(context)` followed by `this._applicationRef.attachView(viewRef)`
// — i.e. the modal's content becomes its OWN root view, ticked unconditionally by
// ApplicationRef on every zone stabilisation, independent of the host component's OnPush
// dirty flag. A MutationObserver on the badge (temporary instrumentation, not committed —
// see the builder's report) showed it updating ~6ms after applyFilter() ran — synchronously
// with the click, not ~1.2s later when a deliberately delayed reload's own markForCheck
// landed — with applyFilter's own markForCheck() call temporarily deleted. The badge simply
// never goes stale long enough for any assertion to catch, at any delay. This
// isn't a masking race to out-clever with better test timing; it's that the guarded call has
// no observable effect via this event path in this component tree shape. Per the house rule,
// no test for this site is committed for kit-index or any of the other eight components
// sharing the identical `<ng-template #filters>` + `NgbModal.open(templateRef)` structure
// (device-request-index, donor-parent-index, referring-organisation-index,
// referring-organisation-contact-index, distributions-and-deliveries-index, kit-component,
// donor-component, referee-component) — see the builder's report for the full record.

test.describe('OnPush fan-out — delivery-slots under its OnPush ancestor (priority 3) @mocked', () => {
  async function openDeliverySlots(page: Page, handlers: Record<string, unknown>): Promise<void> {
    await installMocks(page, {
      findAllDeviceRequests: { deviceRequestConnection: { totalElements: 0, content: [] } },
      ...handlers,
    });
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
  }

  test('load() error branch: the "Loading…" state clears instead of hanging', async ({ page }) => {
    test.setTimeout(60_000);
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findAllDeviceRequests')) return fulfillJson(route, { deviceRequestConnection: { totalElements: 0, content: [] } });
      if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
        // A GraphQL error response — deliveryBookingsAdmin comes back null, which the
        // component's `error` handler must still clear `loading` for. Delayed so it resolves
        // in a later zone macrotask than the page's initial load — otherwise the OnPush
        // ancestor's dirty flag from that first CD pass (still set when this response lands
        // near-instantly) incidentally repaints this subtree regardless of this site's own
        // markForCheck, masking the very thing this test exists to catch.
        await new Promise((r) => setTimeout(r, 300));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ errors: [{ message: 'boom' }], data: null }),
        });
        return;
      }
      return fulfillJson(route, {});
    });

    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();

    // Without the error branch's markForCheck, `loading` flips to false in memory but the
    // spinner text never repaints under the OnPush ancestor and this never appears — the
    // assertion (not a preceding "is it visible yet" check, which races the mocked response)
    // is the guard.
    await expect(page.getByText('No bookings yet.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Loading delivery slot settings…')).toHaveCount(0);
  });

  const BOOKING = {
    id: 'bk-1',
    date: '2026-08-03',
    dayLabel: 'Monday 3 August',
    window: { id: 'win-1', name: 'Morning window' },
    firstName: 'Erin',
    surname: 'Exportable',
    email: 'erin@example.org',
    phone: '07700900101',
    address: 'no postcode here',
    accessNotes: '',
    ctaReference: 9101,
    createdAt: '2026-07-18T09:05:00Z',
  };

  test('exportCsv() success branch: the Export button returns from "Exporting…"', async ({ page }) => {
    test.setTimeout(60_000);
    await openDeliverySlots(page, {
      deliverySlotsAdmin: { deliveryBookingsAdmin: [BOOKING] },
      deliveryExportOrgs: { deviceRequestConnection: { content: [] } },
    });
    await expect(page.locator('tr', { hasText: 'Erin Exportable' })).toBeVisible({ timeout: 15_000 });

    const button = page.getByTestId('export-bookings-csv');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^delivery-schedule-\d{4}-\d{2}-\d{2}\.csv$/);

    // Without the success branch's markForCheck, `exporting` flips back to false in memory
    // but the button stays stuck on "Exporting…" under the OnPush ancestor.
    await expect(button).toHaveText('Export CSV', { timeout: 10_000 });
    await expect(button).toBeEnabled();
  });

  test('exportCsv() error branch: the Export button returns from "Exporting…" after a failed org lookup', async ({ page }) => {
    test.setTimeout(60_000);
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findAllDeviceRequests')) return fulfillJson(route, { deviceRequestConnection: { totalElements: 0, content: [] } });
      if (body.includes('deliverySlotsAdmin') || body.includes('deliveryBookingsAdmin')) {
        return fulfillJson(route, { deliveryBookingsAdmin: [BOOKING] });
      }
      if (body.includes('deliveryExportOrgs')) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'org lookup failed' }] }) });
        return;
      }
      return fulfillJson(route, {});
    });
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.getByRole('link', { name: 'Delivery Slots' }).click();
    await expect(page.locator('tr', { hasText: 'Erin Exportable' })).toBeVisible({ timeout: 15_000 });

    const button = page.getByTestId('export-bookings-csv');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button.click(),
    ]);
    // The failed org lookup still falls back to a blank-org CSV rather than losing the export.
    expect(download.suggestedFilename()).toMatch(/^delivery-schedule-\d{4}-\d{2}-\d{2}\.csv$/);

    // Without the error branch's markForCheck, `exporting` flips back to false in memory but
    // the button stays stuck on "Exporting…" under the OnPush ancestor.
    await expect(button).toHaveText('Export CSV', { timeout: 10_000 });
    await expect(button).toBeEnabled();
  });
});
