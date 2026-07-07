/**
 * Batch 5.3 — Device-request lifecycle spec (create → assign → transitions → complete).
 *
 * Exercises the real staff request-fulfilment workflow end-to-end through the UI
 * against the live UAT backend (api-testing.communitytechaid.org.uk):
 *
 *   0. FIXTURES — a referring organisation, a referee (contact), a device
 *                 request (via `createDeviceRequest`, the same mutation the
 *                 public org-request form fires — the dashboard has no admin
 *                 create UI for requests), and a laptop kit to assign. All
 *                 created via GraphQL and owned by this spec.
 *   1. OPEN     — load the request's detail page; assert it arrives as a NEW
 *                 request wired to the right org/referee.
 *   2. TRANSITION 1 — status radio NEW → "Equalities data complete", Save via
 *                 `devreq-save`, assert on the `updateDeviceRequest` response.
 *   3. ASSIGN   — open the Assign Devices modal (`devreq-assign-open`, gated on
 *                 `app:bulkedit`), enter the kit id, walk the prepare → confirm
 *                 phases, assert the `assignKitsToDeviceRequest` response lists
 *                 the kit and the modal reports success; the Devices tab label
 *                 must tick over to "1 Device Assigned".
 *   4. TRANSITION 2 — "Collection/Delivery arranged" + collection date, method
 *                 (Delivery) and contact name, Save, assert the response.
 *   5. COMPLETE — "Completed" + the isPrepped flag (only rendered once the
 *                 request is past the equalities stage), Save, assert.
 *   6. PERSIST  — reload the page and confirm status/collection details/device
 *                 count survived; server-side, the request must be
 *                 REQUEST_COMPLETED with the kit still attached.
 *
 * Ownership/teardown: the kit, contact, and organisation are tracked and
 * archived by the UatGraphQLClient teardown (the UAT token cannot hard-delete —
 * see helpers/graphql.ts). The DEVICE REQUEST ITSELF CANNOT BE REMOVED with
 * this token (no archive path, delete denied); per the accepted residue policy
 * (2026-07-06) it is tracked anyway — so a future delete-capable token cleans
 * it — and otherwise left in UAT, labelled `E2E-5.3-<timestamp>` in clientRef,
 * and reported via a test annotation.
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid bearer token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is missing/expired or is the CI-minted fake (mirrors the pattern
 * in teardown-helper.spec.ts / device-intake.spec.ts / donor-crud.spec.ts).
 */
function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') {
    return 'CI fake token — real UAT writes not possible';
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) {
      return 'UAT bearer token expired — run e2e/save-token.mjs with a fresh one';
    }
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

const tokenProblem = uatTokenUnavailable();

/**
 * Forward every browser `/graphql` call to the real UAT API from Node.js,
 * injecting the bearer token and stripping the Origin/CORS fetch headers the
 * UAT API rejects. Same interceptor the other real-UAT UI specs use.
 */
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
        headers: {
          ...safeHeaders,
          Authorization: `Bearer ${token}`,
          host: 'api-testing.communitytechaid.org.uk',
        },
      });
      await route.fulfill({ response });
    } catch {
      // Context may have closed while an in-flight background request was pending.
    }
  });
}

test.describe('Device-request lifecycle (create → assign → transitions → complete)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    uat = await UatGraphQLClient.create();
    // The UAT backend (Azure App Service) cold-starts and the app shows a
    // "Server is starting up" overlay until it responds. Warm it up before
    // driving the UI so the flow isn't racing the spin-up.
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
  });

  test.afterAll(async () => {
    // Safety net: dispose archives the kit/contact/org even if the spec threw
    // mid-flow, and notes the device request as accepted residue.
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('walks a request from NEW through assignment and collection to REQUEST_COMPLETED', async ({ page }) => {
    test.setTimeout(150_000);
    await withAuthInterceptor(page);

    const stamp = Date.now();
    const label = `E2E-5.3-${stamp}`;
    const contactName = `${label}-REFEREE`;
    const collectionContact = `${label}-COLLECTOR`;

    // ── 0. FIXTURES via GraphQL (all owned by this spec) ────────────────────
    // Org + referee first: CreateDeviceRequestInput's only required field is
    // the referring organisation contact, and owning both means teardown can
    // archive them rather than polluting a real organisation's referee list.
    const { createReferringOrganisation: org } = await uat.request<{
      createReferringOrganisation: { id: string };
    }>(
      `mutation ($data: CreateReferringOrganisationInput!) {
        createReferringOrganisation(data: $data) { id }
      }`,
      { data: { name: label, website: null, phoneNumber: null } },
    );
    uat.track('referringOrganisation', org.id);

    const { createReferringOrganisationContact: contact } = await uat.request<{
      createReferringOrganisationContact: { id: string };
    }>(
      `mutation ($data: CreateReferringOrganisationContactInput!) {
        createReferringOrganisationContact(data: $data) { id }
      }`,
      {
        data: {
          fullName: contactName,
          email: `${label.toLowerCase()}@example.org`,
          phoneNumber: '07700900000',
          address: '1 Test Street, London',
          referringOrganisation: org.id,
        },
      },
    );
    uat.track('referringOrganisationContact', contact.id);

    // The request itself — same mutation and payload shape as the public
    // org-request form (org-request.ts). One laptop keeps exactly one of the
    // eight deviceRequestItems fields visible on the detail form.
    const { createDeviceRequest: request } = await uat.request<{
      createDeviceRequest: { id: string; status: string };
    }>(
      `mutation ($data: CreateDeviceRequestInput!) {
        createDeviceRequest(data: $data) { id status }
      }`,
      {
        data: {
          clientRef: label,
          details: 'E2E 5.3 lifecycle spec — safe to remove',
          referringOrganisationContact: contact.id,
          deviceRequestItems: { laptops: 1 },
          borough: 'Lambeth',
        },
      },
    );
    const requestId = String(request.id);
    // Tracked so a future delete-capable token cleans it up; with the current
    // token teardown notes it as accepted residue (see spec header).
    uat.track('deviceRequest', requestId);
    expect(request.status, 'a freshly created request must arrive as NEW').toBe('NEW');

    // A device to assign. quickCreateKit is what the kit-index modal fires;
    // LAPTOP matches the single requested item.
    const { quickCreateKit: kit } = await uat.request<{
      quickCreateKit: { id: string };
    }>(
      `mutation ($data: QuickCreateKitInput!) { quickCreateKit(data: $data) { id } }`,
      { data: { type: 'LAPTOP', make: 'E2E', model: label } },
    );
    const kitId = String(kit.id);
    uat.track('kit', kitId);

    // ── 1. OPEN the request detail page ─────────────────────────────────────
    await page.goto(`/dashboard/device-requests/${requestId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    // Header links carry the fixture org + referee names. (Don't assert on
    // `.card-header` broadly — once the model loads, the Devices/Audit tabs
    // add their own card headers and the locator goes strict-mode ambiguous.)
    await expect(page.getByRole('link', { name: label, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: contactName })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'New request' })).toBeChecked({ timeout: 15_000 });
    await expect(page.getByLabel("Organisation's client reference")).toHaveValue(label);
    // Nothing assigned yet.
    await expect(page.getByRole('tab', { name: 'No Devices Assigned' })).toBeVisible();

    // Every Save round-trips the same mutation; small helper to click + assert.
    const saveAndCapture = async () => {
      const updateResponse = page.waitForResponse(
        r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateDeviceRequest'),
        { timeout: 20_000 },
      );
      await page.getByTestId('devreq-save').click();
      const json = await (await updateResponse).json();
      expect(json.errors, `update must not error: ${JSON.stringify(json.errors)}`).toBeFalsy();
      return json.data?.updateDeviceRequest;
    };

    // ── 2. TRANSITION 1: NEW → Equalities data complete ─────────────────────
    await page.getByRole('radio', { name: 'Equalities data complete' }).check();
    let updated = await saveAndCapture();
    expect(updated?.id).toBe(requestId);
    expect(updated.status).toBe('PROCESSING_EQUALITIES_DATA_COMPLETE');

    // ── 3. ASSIGN the kit via the bulk-assign modal (app:bulkedit gated) ────
    await expect(
      page.getByTestId('devreq-assign-open'),
      'the UAT token carries app:bulkedit, so the Assign Devices control must render',
    ).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('devreq-assign-open').click();

    await page.locator('#assignDeviceInput').fill(kitId);
    await page.getByTestId('devreq-assign-prepare').click();
    // Confirmation phase names the count and the request.
    await expect(page.locator('.modal-body .alert-warning')).toContainText(`#${requestId}`);

    const assignResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('assignKitsToDeviceRequest'),
      { timeout: 20_000 },
    );
    await page.getByTestId('devreq-assign-confirm').click();
    const assignJson = await (await assignResponse).json();
    expect(assignJson.errors, `assign must not error: ${JSON.stringify(assignJson.errors)}`).toBeFalsy();
    const assignedKits: { id: string }[] = assignJson.data?.assignKitsToDeviceRequest?.kits ?? [];
    expect(
      assignedKits.some(k => String(k.id) === kitId),
      'assignKitsToDeviceRequest must list the assigned kit',
    ).toBe(true);

    // The modal's per-device result list must report success…
    await expect(page.locator('.modal-body')).toContainText('Assigned successfully', { timeout: 15_000 });
    // Two "Close" buttons exist (header × has aria-label "Close" too) — use the footer's.
    await page.locator('.modal-footer').getByRole('button', { name: 'Close', exact: true }).click();
    // …and the Devices tab label re-counts via fetchDeviceCount.
    await expect(page.getByRole('tab', { name: '1 Device Assigned' })).toBeVisible({ timeout: 15_000 });

    // ── 4. TRANSITION 2: collection/delivery arranged, with booking details ─
    // Exact name: "Collection/Delivery arranged" must not match "…Failed".
    await page.getByRole('radio', { name: 'Collection/Delivery arranged', exact: true }).check();
    await page.getByLabel('Collection/Delivery Date & Time').fill('2026-07-08T10:30');
    await page.getByRole('radio', { name: 'Delivery', exact: true }).check();
    await page.getByLabel('Contact Name').fill(collectionContact);

    updated = await saveAndCapture();
    expect(updated.status).toBe('PROCESSING_COLLECTION_DELIVERY_ARRANGED');
    expect(updated.collectionMethod).toBe('DELIVERY');
    expect(updated.collectionContactName).toBe(collectionContact);
    expect(updated.collectionDate, 'the booking date must round-trip').toBeTruthy();

    // ── 5. COMPLETE: status → Completed + mark the request prepped ──────────
    // isPrepped is hidden while the request is NEW / equalities-stage; now that
    // it is past that, the checkbox must have appeared.
    const preppedBox = page.getByRole('checkbox', { name: 'Is request fully prepped?' });
    await expect(preppedBox).toBeVisible({ timeout: 10_000 });
    await preppedBox.check();
    await page.getByRole('radio', { name: 'Completed', exact: true }).check();

    updated = await saveAndCapture();
    expect(updated.status).toBe('REQUEST_COMPLETED');
    expect(updated.isPrepped).toBe(true);
    expect(
      (updated.kits ?? []).some((k: { id: string }) => String(k.id) === kitId),
      'completing the request must not detach the assigned kit',
    ).toBe(true);

    // ── 6. PERSIST: reload and confirm the final state survived ─────────────
    await page.goto(`/dashboard/device-requests/${requestId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByRole('radio', { name: 'Completed', exact: true })).toBeChecked({ timeout: 15_000 });
    await expect(page.getByLabel('Contact Name')).toHaveValue(collectionContact);
    await expect(page.getByRole('checkbox', { name: 'Is request fully prepped?' })).toBeChecked();
    await expect(page.getByRole('tab', { name: '1 Device Assigned' })).toBeVisible();

    // Server-side confirmation of the end state.
    const after = await uat.request<{
      deviceRequest: { status: string; isPrepped: boolean; kits: { id: string }[] } | null;
    }>(
      `query ($id: Long) {
        deviceRequest(where: { id: { _eq: $id } }) { status isPrepped kits { id } }
      }`,
      { id: requestId },
    );
    expect(after.deviceRequest?.status).toBe('REQUEST_COMPLETED');
    expect(after.deviceRequest?.isPrepped).toBe(true);
    expect(after.deviceRequest?.kits.some(k => String(k.id) === kitId)).toBe(true);

    // ── 7. TEARDOWN: explicit cleanup; afterAll dispose is the safety net. ──
    // Archives the kit, contact, and org; the device request itself has no
    // archive path and the token cannot delete it — accepted residue, noted
    // loud enough to find later.
    await uat.cleanup();
    test.info().annotations.push({
      type: 'uat-residue',
      description: `deviceRequest #${requestId} (clientRef ${label}) left in UAT per accepted residue policy (2026-07-06)`,
    });

    const residueCheck = await uat.request<{
      kit: { archived: boolean } | null;
      referringOrganisation: { archived: boolean } | null;
      referringOrganisationContact: { archived: boolean } | null;
    }>(
      `query ($kitId: Long, $orgId: Long, $contactId: Long) {
        kit(where: { id: { _eq: $kitId } }) { archived }
        referringOrganisation(where: { id: { _eq: $orgId } }) { archived }
        referringOrganisationContact(where: { id: { _eq: $contactId } }) { archived }
      }`,
      { kitId, orgId: org.id, contactId: contact.id },
    );
    expect(residueCheck.kit?.archived, 'kit must be archived after teardown').toBe(true);
    expect(residueCheck.referringOrganisation?.archived, 'org must be archived after teardown').toBe(true);
    expect(residueCheck.referringOrganisationContact?.archived, 'contact must be archived after teardown').toBe(true);
  });
});
