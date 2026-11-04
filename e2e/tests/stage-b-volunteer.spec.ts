/**
 * Live-UAT check for the POST-STAGE-B volunteer (sheet item 26, permission split).
 *
 * Stage B removes `write:organisations` and `write:referees` from the VOLUNTEER role. This spec
 * runs against real UAT with an M2M token that carries exactly "Volunteer minus those two", so
 * the dashboard and API can be checked as that role would see them BEFORE the role change is made
 * in the (shared) Auth0 tenant.
 *
 * Token: the Auth0 M2M application named "E2E Post-Stage-B Volunteer (test)" (client-credentials
 * grant, audience = the Techaid API). The server reads authorities from the JWT `permissions`
 * claim and the dashboard does the same (UserState decodes `token.permissions`), so an M2M token
 * drives both. api-testing must have the app's client ID in AUTH0_ALLOWED_CLIENTS (the `azp`
 * allow-list). Mint it, then save it as the e2e token, e.g. (PowerShell):
 *
 *   $app = auth0 apps list --json --no-input | ConvertFrom-Json | ? name -eq 'E2E Post-Stage-B Volunteer (test)'
 *   # fetch the secret with `auth0 apps show <client_id> --reveal-secrets --json`, POST
 *   # { grant_type: client_credentials, client_id, client_secret, audience: <API identifier> }
 *   # to https://techaid-auth.eu.auth0.com/oauth/token, then:
 *   $env:E2E_BEARER_TOKEN = '<access_token>'; node e2e/save-token.mjs
 *
 * The spec SELF-SKIPS unless the saved token has write:requests and lacks both write:organisations
 * and write:referees, so a normal admin token can never make it pass vacuously.
 *
 * UAT write policy: the only records touched are named "E2E Sample ..." (see helpers/sample-data.ts
 * and `npm run e2e:cleanup`). The volunteer token cannot create organisations/referees, so the
 * request under test is an existing "E2E Sample" request; if there is none, one is created
 * against an existing "E2E Sample" referee (seed them with the device-request-lifecycle spec and
 * an admin token). Device requests cannot be removed with a non-delete token (accepted residue).
 *
 * Not tagged @mocked: needs real UAT and a real token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { E2E_SAMPLE_MARKER, sampleName } from '../helpers/sample-data';

function tokenClaims(): { permissions: string[]; exp: number } | string {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) return 'Saved token expired - mint a fresh one';
    return { permissions: claims.permissions ?? [], exp: claims.exp };
  } catch {
    return 'Saved token is not a decodable JWT';
  }
}

function skipReason(): string | null {
  const c = tokenClaims();
  if (typeof c === 'string') return c;
  const p = c.permissions;
  if (!p.includes('write:requests')) return 'Token lacks write:requests - not the post-Stage-B volunteer token';
  if (p.includes('write:organisations') || p.includes('write:referees')) {
    return 'Token still has write:organisations/write:referees - not the post-Stage-B volunteer token';
  }
  return null;
}
const reason = skipReason();

async function withAuthInterceptor(page: Page): Promise<void> {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    try {
      const safeHeaders = { ...route.request().headers() };
      delete safeHeaders['origin'];
      delete safeHeaders['sec-fetch-site'];
      delete safeHeaders['sec-fetch-mode'];
      delete safeHeaders['sec-fetch-dest'];
      const response = await route.fetch({
        url: 'https://api-testing.communitytechaid.org.uk/graphql',
        headers: { ...safeHeaders, Authorization: `Bearer ${token}`, host: 'api-testing.communitytechaid.org.uk' },
      });
      await route.fulfill({ response });
    } catch {
      // Context closed while a background request was in flight.
    }
  });
}

test.describe('Post-Stage-B volunteer permissions (live UAT)', () => {
  test.skip(reason !== null, reason ?? '');

  let uat: UatGraphQLClient;
  let requestId: string;
  let refereeId: string | undefined;
  let orgId: string | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    uat = await UatGraphQLClient.create();
    // Cold-start warm-up (api-testing can take ~2 min).
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request(`query { deviceRequestConnection(page: { size: 1 }) { totalElements } }`);
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }

    // Request under test: newest existing "E2E Sample" request (reuse, to avoid residue).
    const found = await uat.request<{
      deviceRequestConnection: {
        content: { id: string; referringOrganisationContact: { id: string; referringOrganisation: { id: string } } }[];
      };
    }>(
      `query ($m: String) {
        deviceRequestConnection(page: { size: 1 }, where: { clientRef: { _contains: $m } }) {
          content { id referringOrganisationContact { id referringOrganisation { id } } }
        }
      }`,
      { m: E2E_SAMPLE_MARKER },
    );
    let row = found.deviceRequestConnection.content[0];
    if (!row) {
      const refs = await uat.request<{
        referringOrganisationContactConnection: { content: { id: string; referringOrganisation: { id: string } }[] };
      }>(
        `query ($m: String) {
          referringOrganisationContactConnection(page: { size: 1 }, where: { fullName: { _contains: $m } }) {
            content { id referringOrganisation { id } }
          }
        }`,
        { m: E2E_SAMPLE_MARKER },
      );
      const ref = refs.referringOrganisationContactConnection.content[0];
      if (!ref) throw new Error('No "E2E Sample" request or referee in UAT - seed one with an admin token (device-request-lifecycle spec)');
      const created = await uat.request<{ createDeviceRequest: { id: string } }>(
        `mutation ($data: CreateDeviceRequestInput!) { createDeviceRequest(data: $data) { id } }`,
        {
          data: {
            clientRef: sampleName('Request'),
            details: 'E2E Sample stage-B volunteer spec - safe to remove',
            referringOrganisationContact: ref.id,
            deviceRequestItems: { laptops: 1 },
            borough: 'Lambeth',
          },
        },
      );
      row = {
        id: created.createDeviceRequest.id,
        referringOrganisationContact: { id: ref.id, referringOrganisation: ref.referringOrganisation },
      };
    }
    requestId = String(row.id);
    refereeId = String(row.referringOrganisationContact.id);
    orgId = String(row.referringOrganisationContact.referringOrganisation.id);
  });

  test.afterAll(async () => {
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('can open, edit and save a device request, and add a note', async ({ page }) => {
    test.setTimeout(120_000);
    await withAuthInterceptor(page);
    await page.goto(`/dashboard/device-requests/${requestId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    // write:requests alone must be enough to see Save.
    const save = page.getByTestId('devreq-save');
    await expect(save).toBeVisible({ timeout: 20_000 });

    // Wait for the loaded model to land in the form before editing: formly-form renders (empty)
    // before the query returns, and a late response would overwrite whatever was typed.
    const detailsField = page.getByLabel("Referring organisation's details about the client");
    await expect(detailsField).not.toHaveValue('', { timeout: 20_000 });

    const stamp = Date.now();
    const details = `${E2E_SAMPLE_MARKER} stage-B edit ${stamp}`;
    await detailsField.fill(details);
    const noteText = `${E2E_SAMPLE_MARKER} stage-B note ${stamp}`;
    await page.getByPlaceholder('Type your note here and hit save').fill(noteText);

    const resp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateDeviceRequest'),
      { timeout: 30_000 },
    );
    await save.click();
    const json = await (await resp).json();
    expect(json.errors, `update must not error: ${JSON.stringify(json.errors)}`).toBeFalsy();
    expect(json.data.updateDeviceRequest.id).toBe(requestId);
    expect(json.data.updateDeviceRequest.details).toBe(details);

    // Persisted: reload and see the edit and the note.
    await page.reload();
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByLabel("Referring organisation's details about the client")).toHaveValue(details, { timeout: 15_000 });
    await expect(page.locator('.notes-list')).toContainText(noteText, { timeout: 15_000 });
  });

  test('referee page is read-only (no Save)', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto(`/dashboard/referring-organisation-contacts/${refereeId}`);
    await page.locator('formly-form').first().waitFor({ state: 'visible', timeout: 30_000 });
    // Positive control: fields are rendered and disabled, so absence of Save is not just "not loaded yet".
    await expect(page.locator('formly-form input:not([type=hidden])').first()).toBeDisabled({ timeout: 20_000 });
    await expect(page.getByTestId('contact-save')).toHaveCount(0);
  });

  test('organisation page is read-only (no Save)', async ({ page }) => {
    await withAuthInterceptor(page);
    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await page.locator('formly-form').first().waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.locator('formly-form input:not([type=hidden])').first()).toBeDisabled({ timeout: 20_000 });
    await expect(page.getByTestId('org-save')).toHaveCount(0);
  });

  test('Distributions & Deliveries loads, including the Delivery Slots tab', async ({ page }) => {
    await withAuthInterceptor(page);
    const errors: string[] = [];
    page.on('response', async r => {
      if (r.url().includes('/graphql') && r.request().method() === 'POST') {
        const body = await r.json().catch(() => null);
        if (body?.errors) errors.push(JSON.stringify(body.errors).slice(0, 300));
      }
    });
    await page.goto('/dashboard/distributions-and-deliveries');
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('a.nav-link', { hasText: /slots/i }).first().click();
    await expect(page.locator('app-delivery-slots')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    expect(errors, `GraphQL errors while loading D&D: ${errors.join(' | ')}`).toEqual([]);
  });

  // #294 / PR #297: the booking Delete button needs write:organisations, which Stage B takes from volunteers.
  test('delivery booking Delete button is absent for the volunteer', async ({ page }) => {
    // A count of 0 only means something if bookings are actually rendered, so anchor on a real one.
    const { deliveryBookingsAdmin: bookings } = await uat.request<{ deliveryBookingsAdmin: { id: string }[] }>(
      `query { deliveryBookingsAdmin { id } }`,
    );
    test.skip(bookings.length === 0, 'UAT has no delivery bookings, so there is no row to check the button on');

    await withAuthInterceptor(page);
    await page.goto('/dashboard/distributions-and-deliveries');
    await page.locator('a.nav-link', { hasText: /slots/i }).first().click();
    const slots = page.locator('app-delivery-slots');
    await expect(slots).toBeVisible({ timeout: 20_000 });
    await expect(slots.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(slots.locator('[data-testid="delete-booking"]')).toHaveCount(0);
    await expect(slots.getByRole('button', { name: /^delete$/i })).toHaveCount(0);
  });

  test('API denies organisation/referee writes and booking delete, allows booking reads', async () => {
    const denied = async (q: string, v: Record<string, unknown> = {}) => {
      let msg = '';
      try {
        await uat.request(q, v);
      } catch (e) {
        msg = (e as Error).message;
      }
      return msg;
    };

    const org = await denied(
      `mutation ($data: CreateReferringOrganisationInput!) { createReferringOrganisation(data: $data) { id } }`,
      { data: { name: sampleName('Org'), website: null, phoneNumber: null } },
    );
    expect(org, 'createReferringOrganisation must be denied').toMatch(/Access Denied/i);

    const ref = await denied(
      `mutation ($data: CreateReferringOrganisationContactInput!) { createReferringOrganisationContact(data: $data) { id } }`,
      {
        data: {
          fullName: sampleName('Referee'),
          email: 'stage-b-denied@example.org',
          phoneNumber: '07700900000',
          address: '1 Test Street',
          referringOrganisation: orgId,
        },
      },
    );
    expect(ref, 'createReferringOrganisationContact must be denied').toMatch(/Access Denied/i);

    // Id 0 never exists, so even if authorisation were wrongly granted nothing real is deleted.
    const del = await denied(`mutation { deleteDeliveryBooking(id: "0") }`);
    expect(del, 'deleteDeliveryBooking must be denied').toMatch(/Access Denied/i);

    const bookings = await uat.request<{ deliveryBookingsAdmin: unknown[] }>(
      `query { deliveryBookingsAdmin { id } }`,
    );
    expect(Array.isArray(bookings.deliveryBookingsAdmin)).toBe(true);
  });
});
