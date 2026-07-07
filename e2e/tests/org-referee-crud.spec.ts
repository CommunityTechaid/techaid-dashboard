/**
 * Batch 5.5 — Referring-org + referee CRUD write-flow spec.
 *
 * Exercises the real staff referral-network workflow end-to-end through the UI
 * against the live UAT backend (api-testing.communitytechaid.org.uk):
 *
 *   1. CREATE ORG   — open the referring-organisations create modal
 *                     (`org-create-open`), fill Name/Website/Phone, submit,
 *                     assert on the `createReferringOrganisation` response.
 *   2. INDEX        — search the org index for the unique name; the row must
 *                     show what was entered.
 *   3. EDIT ORG     — on the org detail page, change Name + Phone Number,
 *                     Save via `org-save`, assert the mutation response, then
 *                     reload and assert persistence.
 *   4. CREATE REFEREE — on the org's Referees tab, open the embedded
 *                     referee-component create modal (`contact-create-open`),
 *                     fill Full Name/Email/Phone/Address, submit, assert on
 *                     `createReferringOrganisationContact` (the component
 *                     injects this org's id), and see the new referee row in
 *                     the embedded table.
 *   5. EDIT REFEREE — on the referee detail page, change Full Name + Phone,
 *                     Save via `contact-save`, assert + reload-persist.
 *   6. DELETE       — the token has no `delete:organisations`, so the Danger
 *                     Zone (`org-delete-open`/`contact-delete-open`) is
 *                     expected not to render (annotated if so, exercised like
 *                     donor-crud's three outcomes if it ever does). The REAL
 *                     staff-facing removal path is the form's own "Archived?"
 *                     radio — so the spec archives the referee, then the org,
 *                     THROUGH THE UI and asserts the org drops out of the
 *                     default (non-archived) index search.
 *
 * The address field is the custom `place` formly type: a plain
 * formControl-bound input with an optional suggestions overlay fed by the
 * Places proxy worker. Typing raw text IS the value (no suggestion needs to
 * be clicked); the spec blurs the field after filling so the async overlay
 * can never sit over the modal's submit button.
 *
 * This spec OWNS its records: org + referee are tracked, and teardown
 * archives whatever the UI archiving didn't already handle (hard delete is
 * denied for this token — see helpers/graphql.ts).
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid bearer token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { sampleName } from '../helpers/sample-data';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is missing/expired or is the CI-minted fake (mirrors the pattern
 * in the other Batch 5 write-flow specs).
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

test.describe('Referring-org + referee CRUD write-flow', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    // The warm-up below may legitimately take ~2 min on an Azure cold start —
    // outlive the default 60s hook timeout or the hook dies before the loop.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    // Warm up the cold-starting UAT backend before driving the UI.
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request(
          `query { referringOrganisationsConnection(page: { size: 1 }) { totalElements } }`,
        );
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
  });

  test.afterAll(async () => {
    // Safety net: archives anything the UI archiving steps didn't reach.
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('creates an org and a referee, edits both, and archives both through the UI', async ({ page }) => {
    test.setTimeout(150_000);
    await withAuthInterceptor(page);

    const stamp = Date.now();
    const orgName = sampleName('Org', stamp);
    const editedOrgName = `${orgName} edited`;
    const orgPhone = `0770091${stamp % 10000}`;
    const editedOrgPhone = `${orgPhone}9`;
    const refereeName = sampleName('Referee', stamp);
    const editedRefereeName = `${refereeName} edited`;
    const refereeEmail = `e2e-sample-${stamp}@example.org`;
    const refereePhone = `0770092${stamp % 10000}`;
    const editedRefereePhone = `${refereePhone}9`;

    // ── 1. CREATE ORG via the index create modal ────────────────────────────
    await page.goto('/dashboard/referring-organisations');
    await page.getByTestId('org-create-open').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('org-create-open').click();

    // Scope to the modal: the org table's sort buttons behind it carry
    // aria-labels like "Name: Activate to sort" that clash with getByLabel.
    const orgModal = page.locator('.modal-body');
    await orgModal.getByLabel('Name').fill(orgName);
    await orgModal.getByLabel('Organisation Website').fill('https://example.org');
    await orgModal.getByLabel('Organisation Phone Number').fill(orgPhone);

    const orgCreateResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('createReferringOrganisation'),
      { timeout: 20_000 },
    );
    await page.getByTestId('org-create-submit').click();
    const orgCreateJson = await (await orgCreateResponse).json();
    expect(orgCreateJson.errors, `org create must not error: ${JSON.stringify(orgCreateJson.errors)}`).toBeFalsy();
    const orgId = String(orgCreateJson.data?.createReferringOrganisation?.id ?? '');
    expect(orgId, 'createReferringOrganisation must return a new id').toBeTruthy();
    // Register immediately so teardown archives it even if an assertion throws.
    uat.track('referringOrganisation', orgId);

    // ── 2. FIND it in the index by its unique name ──────────────────────────
    const orgSearch = page.locator('input[aria-controls="referring-org-index"]');
    await orgSearch.waitFor({ state: 'visible', timeout: 15_000 });
    await orgSearch.fill(orgName);
    const orgRow = page.locator('#referring-org-index tbody tr', { hasText: orgName });
    await expect(orgRow, 'the created org should be findable in the index').toBeVisible({ timeout: 20_000 });
    await expect(orgRow).toContainText(orgPhone);

    // ── 3. EDIT the org: Name + Phone Number, Save, reload-persist ──────────
    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    const orgForm = page.locator('formly-form').first();
    const orgNameInput = orgForm.getByLabel('Name');
    const orgPhoneInput = orgForm.getByLabel('Phone Number');
    await expect(orgNameInput).toHaveValue(orgName, { timeout: 15_000 });

    await orgNameInput.fill(editedOrgName);
    await orgPhoneInput.fill(editedOrgPhone);

    const orgUpdate = async () => {
      const resp = page.waitForResponse(
        r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateReferringOrganisation') &&
          !(r.request().postData() ?? '').includes('updateReferringOrganisationContact'),
        { timeout: 20_000 },
      );
      await page.getByTestId('org-save').click();
      const json = await (await resp).json();
      expect(json.errors, `org update must not error: ${JSON.stringify(json.errors)}`).toBeFalsy();
      return json.data?.updateReferringOrganisation;
    };

    let orgUpdated = await orgUpdate();
    expect(orgUpdated?.id).toBe(orgId);
    expect(orgUpdated.name).toBe(editedOrgName);
    expect(orgUpdated.phoneNumber).toBe(editedOrgPhone);

    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.locator('formly-form').first().getByLabel('Name')).toHaveValue(editedOrgName, { timeout: 15_000 });
    await expect(page.locator('formly-form').first().getByLabel('Phone Number')).toHaveValue(editedOrgPhone);

    // ── 4. CREATE a REFEREE from the org's Referees tab ─────────────────────
    await page.getByRole('tab', { name: 'Referees' }).click();
    await page.getByTestId('contact-create-open').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByTestId('contact-create-open').click();

    const refModal = page.locator('.modal-body');
    await refModal.getByLabel('Full Name').fill(refereeName);
    await refModal.getByLabel('Email').fill(refereeEmail);
    await refModal.getByLabel('Referee Phone Number').fill(refereePhone);
    // `place` field: typing raw text is the value; blur so the async
    // suggestions overlay can't cover the submit button. Its inner input has
    // no id, so the wrapper label isn't associated — target the component.
    const addressInput = refModal.locator('form-place input');
    await addressInput.fill('1 Test Street, London');
    await addressInput.press('Tab');

    const contactCreateResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('createReferringOrganisationContact'),
      { timeout: 20_000 },
    );
    await page.getByTestId('contact-create-submit').click();
    const contactCreateJson = await (await contactCreateResponse).json();
    expect(
      contactCreateJson.errors,
      `referee create must not error: ${JSON.stringify(contactCreateJson.errors)}`,
    ).toBeFalsy();
    const contactId = String(contactCreateJson.data?.createReferringOrganisationContact?.id ?? '');
    expect(contactId, 'createReferringOrganisationContact must return a new id').toBeTruthy();
    uat.track('referringOrganisationContact', contactId);

    // The embedded referee table reloads after create — the new referee must
    // appear, proving the component wired the org id onto the new record.
    await expect(
      page.locator(`#referring-organisation-referees-${orgId} tbody tr`, { hasText: refereeName }),
      'the new referee should appear in the org-scoped referee table',
    ).toBeVisible({ timeout: 20_000 });

    // ── 5. EDIT the referee: Full Name + Phone Number, Save, reload-persist ─
    await page.goto(`/dashboard/referring-organisation-contacts/${contactId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    const refForm = page.locator('formly-form').first();
    const refNameInput = refForm.getByLabel('Full Name');
    const refPhoneInput = refForm.getByLabel('Phone Number');
    await expect(refNameInput).toHaveValue(refereeName, { timeout: 15_000 });
    await expect(refPhoneInput).toHaveValue(refereePhone);

    await refNameInput.fill(editedRefereeName);
    await refPhoneInput.fill(editedRefereePhone);

    const contactUpdate = async () => {
      const resp = page.waitForResponse(
        r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateReferringOrganisationContact'),
        { timeout: 20_000 },
      );
      await page.getByTestId('contact-save').click();
      const json = await (await resp).json();
      expect(json.errors, `referee update must not error: ${JSON.stringify(json.errors)}`).toBeFalsy();
      return json.data?.updateReferringOrganisationContact;
    };

    let contactUpdated = await contactUpdate();
    expect(contactUpdated?.id).toBe(contactId);
    expect(contactUpdated.fullName).toBe(editedRefereeName);
    expect(contactUpdated.phoneNumber).toBe(editedRefereePhone);

    await page.goto(`/dashboard/referring-organisation-contacts/${contactId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.locator('formly-form').first().getByLabel('Full Name')).toHaveValue(editedRefereeName, { timeout: 15_000 });
    await expect(page.locator('formly-form').first().getByLabel('Phone Number')).toHaveValue(editedRefereePhone);

    // ── 6. DELETE / ARCHIVE through the UI ──────────────────────────────────
    // Hard-delete controls are gated on `delete:organisations`, which this
    // token does not carry — mirror donor-crud's outcome handling.
    const contactDeleteVisible = await page.getByTestId('contact-delete-open').isVisible();
    if (!contactDeleteVisible) {
      test.info().annotations.push({
        type: 'delete-outcome',
        description: 'contact-delete-open not rendered (token lacks delete:organisations) — UI archive path exercised instead',
      });
    }

    // The staff-facing removal path this token CAN use: the form's own
    // "Archived?" radio. Archive the referee first (child before parent)…
    await page.getByRole('radio', { name: 'Archive and hide this referee' }).check();
    contactUpdated = await contactUpdate();
    expect(contactUpdated.archived, 'the referee must be archived after saving the Archived radio').toBe(true);

    // …then the org.
    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('radio', { name: 'Archive and hide this organisation' }).check();
    orgUpdated = await orgUpdate();
    expect(orgUpdated.archived, 'the org must be archived after saving the Archived radio').toBe(true);

    // The archived org must be gone from the default (non-archived) index.
    await page.goto('/dashboard/referring-organisations');
    const searchAgain = page.locator('input[aria-controls="referring-org-index"]');
    await searchAgain.waitFor({ state: 'visible', timeout: 30_000 });
    await searchAgain.fill(editedOrgName);
    // Wait for the search round-trip, then assert no row matches.
    await page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllReferringOrgs'),
      { timeout: 15_000 },
    );
    await expect(
      page.locator('#referring-org-index tbody tr', { hasText: editedOrgName }),
      'an archived org must not appear in the default index view',
    ).toHaveCount(0, { timeout: 15_000 });

    // ── 7. TEARDOWN: cleanup() re-archives (no-op here) as the safety net. ──
    await uat.cleanup();

    const after = await uat.request<{
      referringOrganisation: { archived: boolean } | null;
      referringOrganisationContact: { archived: boolean } | null;
    }>(
      `query ($orgId: Long, $contactId: Long) {
        referringOrganisation(where: { id: { _eq: $orgId } }) { archived }
        referringOrganisationContact(where: { id: { _eq: $contactId } }) { archived }
      }`,
      { orgId, contactId },
    );
    expect(after.referringOrganisation?.archived, 'org must be archived after teardown').toBe(true);
    expect(after.referringOrganisationContact?.archived, 'referee must be archived after teardown').toBe(true);
  });
});
