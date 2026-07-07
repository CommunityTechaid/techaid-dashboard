/**
 * Batch 5.4 — Donor CRUD write-flow spec (create → index → edit → persist → delete).
 *
 * Exercises the real staff donor-management workflow end-to-end through the UI
 * against the live UAT backend (api-testing.communitytechaid.org.uk):
 *
 *   1. CREATE  — open the donor-index create modal, fill the required fields
 *                (Name, Email, Phone Number, and — a real constraint of this
 *                form — a Parent Donor selected via the ng-select typeahead,
 *                since `donorParentField` is `required: true` with no
 *                expressionProperties override), submit, and assert on the
 *                `createDonor` mutation response (capturing the new id).
 *   2. INDEX   — search the donor list by the unique name and assert the row
 *                shows the name/email/phone/parent-donor that were entered.
 *   3. UPDATE  — open donor-info, edit the Full Name + Phone Number, Save via
 *                the `donor-save` control, assert the `updateDonor` mutation
 *                reflects the change, then reload and assert persistence.
 *   4. DELETE  — exercise the UI delete flow. Three outcomes are handled
 *                explicitly (see the giant comment above the delete block for
 *                why there are three, not two):
 *                (a) the Danger Zone / `donor-delete-open` control isn't even
 *                    rendered because this token's JWT `permissions` list has
 *                    no `delete:donors` claim (donor-info.html gates the whole
 *                    section on `user.authorities['delete:donors']`) — the
 *                    archive fallback in teardown is the only path here;
 *                (b) the control renders, the mutation is denied server-side
 *                    ("Access Denied") — assert the app surfaces the failure
 *                    (toast, no navigation, donor still present) rather than
 *                    crashing or silently "succeeding";
 *                (c) the mutation succeeds — assert the donor is gone from the
 *                    index.
 *                Whichever branch actually runs, the donor must not remain
 *                ACTIVE in UAT afterwards — `uat.cleanup()` archives it if the
 *                hard delete didn't already remove it.
 *
 * This spec OWNS its records. The donor (and nothing else — the Parent Donor
 * used for the required selector is a pre-existing UAT record, chosen by
 * reading the real data rather than creating throwaway parents) is registered
 * with the UatGraphQLClient tracker and removed in afterAll even if an
 * assertion throws mid-flow.
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid bearer token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { sampleName } from '../helpers/sample-data';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is missing/expired or is the CI-minted fake (mirrors the pattern
 * in teardown-helper.spec.ts / device-intake.spec.ts).
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

test.describe('Donor CRUD write-flow (create → index → edit → persist → delete)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    // The warm-up below may legitimately take ~2 min on an Azure cold start —
    // outlive the default 60s hook timeout or the hook dies before the loop.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    // The UAT backend (Azure App Service) cold-starts and the app shows a
    // "Server is starting up" overlay until it responds. Warm it up before
    // driving the UI so the create/edit flow isn't racing the spin-up.
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request(`query { donorsConnection(page: { size: 1 }) { totalElements } }`);
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
  });

  test.afterAll(async () => {
    // Safety net: dispose removes anything still tracked. A failed test may have
    // created a donor without reaching an explicit cleanup — this archives it.
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('creates a donor, finds it in the index, edits it, persists, and handles UI delete', async ({ page }) => {
    test.setTimeout(120_000);
    await withAuthInterceptor(page);

    const stamp = Date.now();
    const uniqueName = sampleName('Donor', stamp);
    const email = `e2e-5.4-${stamp}@example.com`;
    const phone = `0770090${stamp % 10000}`;
    const editedName = `${uniqueName} edited`;
    const editedPhone = `${phone}9`;

    // A real Parent Donor to satisfy `donorParentField`'s `required: true` (no
    // expressionProperties override — unlike email/phoneNumber, this field is
    // unconditionally required on the create form). Pick an existing active
    // one rather than creating throwaway data this spec would also have to
    // own and clean up.
    const parentPool = await uat.request<{
      donorParentsConnection: { content: { id: string; name: string }[] };
    }>(
      `query { donorParentsConnection(page: { size: 1 }, where: { archived: { _eq: false } }) { content { id name } } }`,
    );
    const parentDonor = parentPool.donorParentsConnection.content[0];
    expect(parentDonor, 'UAT must have at least one active donor parent to select in the create form').toBeTruthy();
    const parentSearchTerm = parentDonor.name.trim().slice(0, 4);

    // ── 1. CREATE via the donor-index create modal ─────────────────────────
    await page.goto('/dashboard/donors');
    await page.getByTestId('donor-create-open').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('donor-create-open').click();

    await page.getByLabel('Name').fill(uniqueName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Phone Number').fill(phone);

    // Parent Donor ng-select: type a substring of an existing parent's name,
    // wait for the typeahead query, then click the matching option.
    const parentSelect = page.locator('.modal-body ng-select');
    const parentSelectInput = parentSelect.locator('input');
    const parentSearchResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAutocompleteDonorParents'),
      { timeout: 15_000 },
    );
    await parentSelectInput.fill(parentSearchTerm);
    await parentSearchResp;
    const parentOption = page.locator('.ng-option', { hasText: parentDonor.name.trim() }).first();
    await parentOption.waitFor({ state: 'visible', timeout: 10_000 });
    await parentOption.click();

    const createResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('createDonor'),
      { timeout: 20_000 },
    );
    await page.getByTestId('donor-create-submit').click();
    const createRes = await createResponse;

    const createJson = await createRes.json();
    expect(createJson.errors, `create must not error: ${JSON.stringify(createJson.errors)}`).toBeFalsy();
    const created = createJson.data?.createDonor;
    expect(created?.id, 'createDonor must return a new donor id').toBeTruthy();

    const donorId = String(created.id);
    // Register immediately so teardown removes it even if a later assertion throws.
    uat.track('donor', donorId);
    expect(created.name).toBe(uniqueName);
    expect(created.email).toBe(email);
    expect(created.phoneNumber).toBe(phone);

    // ── 2. FIND it in the index by its unique name ─────────────────────────
    const searchInput = page.locator('input[aria-controls="donor-index"]');
    await searchInput.waitFor({ state: 'visible', timeout: 15_000 });
    await searchInput.fill(uniqueName);

    const row = page.locator('#donor-index tbody tr', { hasText: uniqueName });
    await expect(row, 'the created donor should be findable in the index by its name').toBeVisible({
      timeout: 20_000,
    });
    await expect(row).toContainText(uniqueName);
    await expect(row).toContainText(email);
    await expect(row).toContainText(parentDonor.name.trim());

    // ── 3. UPDATE on the donor-info page: edit Full Name + Phone Number ────
    await page.goto(`/dashboard/donors/${donorId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    const fullNameInput = page.getByLabel('Full Name');
    const phoneInput = page.getByLabel('Phone Number');
    await expect(fullNameInput).toHaveValue(uniqueName, { timeout: 15_000 });
    await expect(phoneInput).toHaveValue(phone);

    await fullNameInput.fill(editedName);
    await phoneInput.fill(editedPhone);

    const updateResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateDonor'),
      { timeout: 20_000 },
    );
    await page.getByTestId('donor-save').click();
    const updateRes = await updateResponse;

    const updateJson = await updateRes.json();
    expect(updateJson.errors, `update must not error: ${JSON.stringify(updateJson.errors)}`).toBeFalsy();
    const updated = updateJson.data?.updateDonor;
    expect(updated?.id, 'updateDonor must return the donor').toBe(donorId);
    expect(updated.name, 'updateDonor response must carry the edited name').toBe(editedName);
    expect(updated.phoneNumber, 'updateDonor response must carry the edited phone number').toBe(editedPhone);

    // ── 4. PERSIST: reload the donor-info page and confirm the edits survived ──
    await page.goto(`/dashboard/donors/${donorId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByLabel('Full Name')).toHaveValue(editedName, { timeout: 15_000 });
    await expect(page.getByLabel('Phone Number')).toHaveValue(editedPhone);

    // ── 5. DELETE (UI path) ─────────────────────────────────────────────────
    // This token's JWT `permissions` list (see e2e/helpers/graphql.ts header)
    // has no `delete:donors` claim, and donor-info.html gates the entire
    // Danger Zone section — including `donor-delete-open` — behind
    // `user.authorities['delete:donors']`. So the control may simply not be
    // in the DOM for this token, which is a real, distinct outcome from "the
    // backend denied the mutation" and must be handled rather than assumed
    // away. By the time we reach this point donor-save has already been
    // clicked, so the user$ subscription that drives both the Save button and
    // the Danger Zone visibility has long since resolved — no extra wait
    // needed before checking.
    const deleteOpenVisible = await page.getByTestId('donor-delete-open').isVisible();

    if (!deleteOpenVisible) {
      // Outcome (a): permission-gated — the UI never offers the control.
      test.info().annotations.push({
        type: 'delete-outcome',
        description: 'donor-delete-open not rendered (token lacks delete:donors permission) — archive fallback only',
      });
    } else {
      await page.getByTestId('donor-delete-open').click();
      const deleteResponse = page.waitForResponse(
        r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('deleteDonor'),
        { timeout: 20_000 },
      );
      await page.getByTestId('donor-delete-confirm').click();
      const deleteRes = await deleteResponse;
      const deleteJson = await deleteRes.json();

      if (deleteJson.errors) {
        // Outcome (b): backend denies the hard delete ("Access Denied").
        test.info().annotations.push({
          type: 'delete-outcome',
          description: `deleteDonor denied by backend: ${JSON.stringify(deleteJson.errors)}`,
        });
        // The app must surface this sanely: an error toast, no crash, and no
        // silent "success" navigation away from the donor page.
        await expect(page.locator('.toast-error, [role="alert"]').first()).toBeVisible({ timeout: 10_000 });
        await expect(page).toHaveURL(new RegExp(`/dashboard/donors/${donorId}$`));

        // Confirm the donor is still present (denial didn't silently delete it).
        const stillThere = await uat.request<{ donor: { id: string } | null }>(
          `query ($id: Long) { donor(where: { id: { _eq: $id } }) { id } }`,
          { id: donorId },
        );
        expect(stillThere.donor?.id, 'donor must still exist after a denied delete').toBe(donorId);
      } else {
        // Outcome (c): the hard delete actually succeeded.
        expect(deleteJson.data?.deleteDonor).toBe(true);
        test.info().annotations.push({ type: 'delete-outcome', description: 'deleteDonor succeeded' });
        await expect(page).toHaveURL(/\/dashboard\/donors$/, { timeout: 15_000 });

        const afterDeleteSearch = page.locator('input[aria-controls="donor-index"]');
        await afterDeleteSearch.waitFor({ state: 'visible', timeout: 15_000 });
        await afterDeleteSearch.fill(uniqueName);
        await expect(page.locator('#donor-index tbody tr', { hasText: uniqueName })).toHaveCount(0, {
          timeout: 15_000,
        });
      }
    }

    // ── 6. TEARDOWN: explicit cleanup here; afterAll dispose is the safety net.
    // Whichever branch above ran, the donor must not remain ACTIVE afterwards.
    // If the hard delete already succeeded, cleanup() is a no-op for it (the
    // archive fallback's `if (!donor) return;` guard handles the missing row).
    await uat.cleanup();

    const after = await uat.request<{ donor: { id: string; archived: boolean } | null }>(
      `query ($id: Long) { donor(where: { id: { _eq: $id } }) { id archived } }`,
      { id: donorId },
    );
    expect(
      after.donor === null || after.donor.archived === true,
      'donor must be either gone or archived after teardown — never left active',
    ).toBe(true);
  });
});
