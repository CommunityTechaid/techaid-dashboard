/**
 * #381, last part: the inline (non-toast) error displays show friendly text (or the server's
 * deliberate words) plus the request's ref, the same rule as the error toasts
 * (error-toast-ref.spec.ts), and never the server's internals.
 *
 * Before this, these displays printed `errorText(err)` / `err.message` as it came: a leaked SQL
 * message, with whatever record data it held, went straight onto the page, and there was no ref
 * for staff to quote.
 *
 * What it pins:
 *   - Update Scanner banner: an unexpected failure (leaked SQL holding a personal-data-like
 *     sentinel) shows "Something went wrong." and the ref the updateKits request carried; a
 *     deliberate rejection (the wipe-cert guard) keeps its wording, with the ref after it.
 *   - Bulk-assign results (device request page): the same unexpected failure, per device row.
 *   - Organisation History tab's load error: the same unexpected failure.
 *   - Markup in a server message is shown as text, never rendered.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; the Auth0 cache is written directly.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';
import { UNEXPECTED_TEXT } from '../../src/app/shared/utils/error-toast';

const TS = '2026-01-01T00:00:00Z';
const SENTINEL = 'sentinel.inline.381@example.invalid';
const SQL_MESSAGE = `could not execute statement; SQL [n/a]; constraint [kits_pkey]; Key (email)=(${SENTINEL}) `
  + 'already exists <img src="x" id="injected-inline-381">';
const REF_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

const sqlFailure = { data: null, errors: [{ message: SQL_MESSAGE, extensions: { classification: 'DataFetchingException' } }] };

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Answers the probes every page makes; returns true when it handled the request. */
async function common(route: Route, raw: string): Promise<boolean> {
  if (raw.includes('buildInfo')) {
    await json(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } } });
    return true;
  }
  if (raw.includes('featureFlagsPublic')) {
    await json(route, { data: { featureFlagsPublic: [{ key: 'update-scanner', enabled: true }] } });
    return true;
  }
  return false;
}

async function expectNoInternals(page: Page, text: string): Promise<void> {
  expect(text).not.toContain(SENTINEL);
  expect(text).not.toContain('constraint');
  await expect(page.locator('#injected-inline-381')).toHaveCount(0);
}

// ── Update Scanner ────────────────────────────────────────────────────────────

async function scannerMocks(page: Page, failure: unknown): Promise<string[]> {
  const refs: string[] = [];
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (await common(route, raw)) return;
    if (raw.includes('updateKits')) {
      refs.push((await route.request().allHeaders())['x-cta-ref']);
      return json(route, failure);
    }
    if (raw.includes('scannerKit')) {
      return json(route, {
        data: {
          kit: {
            id: '19251', make: 'Dell', model: 'Latitude 5490', status: 'PROCESSING_WIPED', archived: false,
            subStatus: {
              wipeFailed: false, installationOfOSFailed: false, needsFurtherInvestigation: false,
              needsSparePart: false, lockedToUser: false,
            },
          },
        },
      });
    }
    return json(route, { data: {} });
  });
  return refs;
}

async function scanAndFail(page: Page, failure: unknown) {
  await loginWith(page, ['app:bulkedit']);
  const refs = await scannerMocks(page, failure);
  await page.goto('/dashboard/devices/update-scanner');
  const field = page.getByTestId('scanner-field');
  await expect(field).toBeVisible({ timeout: 30_000 });
  for (const raw of ['CTA*OS-INSTALLED', '19251']) {
    await field.fill(raw);
    await field.press('Enter');
  }
  await expect.poll(() => refs.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(refs[0], 'the request carried a well-formed ref').toMatch(REF_RE);
  return { banner: page.getByTestId('scanner-banner'), ref: refs[0] };
}

test.describe('inline error displays show friendly text and the error ref @mocked', () => {
  test('update scanner: an unexpected failure shows friendly text and the ref', async ({ page }) => {
    test.setTimeout(60_000);
    const { banner, ref } = await scanAndFail(page, sqlFailure);
    await expect(banner).toContainText(`#19251 was not updated — ${UNEXPECTED_TEXT} Ref: ${ref}`, { timeout: 15_000 });
    await expectNoInternals(page, (await banner.textContent()) ?? '');
  });

  test('update scanner: a deliberate rejection keeps its wording, with the ref', async ({ page }) => {
    test.setTimeout(60_000);
    const deliberate = 'Kit 19251 has no <em>wipe certificate</em> reference recorded';
    const { banner, ref } = await scanAndFail(page, {
      data: null,
      errors: [{ message: deliberate, extensions: { classification: 'BAD_REQUEST' } }],
    });
    await expect(banner).toContainText(`#19251 was not updated — ${deliberate}. Ref: ${ref}`, { timeout: 15_000 });
    await expect(banner.locator('em'), 'server text must not be rendered as HTML').toHaveCount(0);
  });

  // ── Bulk assign ──────────────────────────────────────────────────────────────

  test('bulk assign: an unexpected failure shows friendly text and the ref on the device row', async ({ page }) => {
    test.setTimeout(60_000);
    const REQUEST_ID = 99381;
    const KIT_ID = 16381;
    await loginWith(page, ['app:bulkedit', 'read:organisations', 'write:organisations']);
    const refs: string[] = [];
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      if (await common(route, raw)) return;
      if (raw.includes('mutation') && raw.includes('assignKitsToDeviceRequest')) {
        refs.push((await route.request().allHeaders())['x-cta-ref']);
        return json(route, sqlFailure);
      }
      if (raw.includes('kitsConnection') || raw.includes('countDevicesForRequest')) {
        return json(route, { data: { kitsConnection: { totalElements: 0 } } });
      }
      if (raw.includes('findDeviceRequest') || (raw.includes('deviceRequest') && !raw.includes('mutation'))) {
        return json(route, {
          data: {
            deviceRequest: {
              id: REQUEST_ID, status: 'NEW', createdAt: TS, updatedAt: TS, collectionDate: null,
              collectionMethod: null, collectionContactName: null,
              deviceRequestItems: {
                phones: 0, tablets: 0, laptops: 1, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0,
              },
              referringOrganisationContact: { id: 1, fullName: 'Test Contact', referringOrganisation: { id: 1, name: 'Test Org' } },
              isSales: false, isPrepped: false, clientRef: '', details: '', borough: '', kits: [],
              deviceRequestNeeds: { hasInternet: false, hasMobilityIssues: false, needQuickStart: false },
              deviceRequestNotes: [],
            },
          },
        });
      }
      return json(route, { data: {} });
    });

    await page.goto(`/dashboard/device-requests/${REQUEST_ID}`);
    await expect(page.locator('formly-form')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('devreq-assign-open').click();
    await page.locator('#assignDeviceInput').fill(String(KIT_ID));
    await page.getByTestId('devreq-assign-prepare').click();
    await page.getByTestId('devreq-assign-confirm').click();

    const row = page.locator('.modal-body div.mb-1').filter({ hasText: `Device ${KIT_ID}:` }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    expect(refs[0], 'the request carried a well-formed ref').toMatch(REF_RE);
    await expect(row).toContainText(`Device ${KIT_ID}: ${UNEXPECTED_TEXT} Ref: ${refs[0]}`);
    await expectNoInternals(page, (await row.textContent()) ?? '');
  });

  // ── Organisation History tab ───────────────────────────────────────────────────

  test('organisation history: a load failure shows friendly text and the ref', async ({ page }) => {
    test.setTimeout(60_000);
    await loginWith(page, ['read:organisations', 'write:organisations', 'admin:organisations']);
    const refs: string[] = [];
    await page.route('**/graphql', async route => {
      const raw = route.request().postData() ?? '';
      if (await common(route, raw)) return;
      if (raw.includes('getReferringOrganisationAuditTrail')) {
        refs.push((await route.request().allHeaders())['x-cta-ref']);
        return json(route, sqlFailure);
      }
      if (raw.includes('findReferringOrganisation(')) {
        return json(route, {
          data: {
            referringOrganisation: {
              id: 5, name: 'HISTORY-ERR-ORG', website: 'https://example.org', phoneNumber: '07700900000',
              archived: false, createdAt: TS, updatedAt: TS, membershipTier: null, membershipStartDate: null,
              membershipEndDate: null, membership: null, membershipContacts: [],
            },
          },
        });
      }
      if (raw.includes('findAllReferringOrgContacts')) {
        return json(route, { data: { referringOrganisationContactsConnection: { totalElements: 0, content: [] } } });
      }
      if (raw.includes('findAllDeviceRequests') || raw.includes('findAllOrgs')) {
        return json(route, { data: { deviceRequestConnection: { totalElements: 0, content: [] } } });
      }
      return json(route, { data: {} });
    });

    await page.goto('/dashboard/referring-organisations/5');
    await page.getByTestId('org-history-tab').click({ timeout: 30_000 });
    const error = page.getByTestId('org-history-error');
    await expect(error).toBeVisible({ timeout: 15_000 });
    expect(refs[0], 'the request carried a well-formed ref').toMatch(REF_RE);
    await expect(error).toContainText(`The history could not be loaded: ${UNEXPECTED_TEXT} Ref: ${refs[0]}`);
    await expectNoInternals(page, (await error.textContent()) ?? '');
  });
});
