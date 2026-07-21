/**
 * Batch 5.2 — Device-intake write-flow spec (create → in index → edit → persist).
 *
 * Exercises the real staff intake workflow end-to-end through the UI against the
 * live UAT backend (api-testing.communitytechaid.org.uk):
 *
 *   1. CREATE  — open the kit-index quick-create modal, fill the required device
 *                fields, submit, and assert on the `quickCreateKit` mutation's
 *                response (capturing the new device id).
 *   2. INDEX   — search the device list for the unique model and assert the row
 *                shows the make/model that were entered.
 *   3. EDIT    — open the device's kit-info page, change make + model, Save via
 *                the `kit-save` control, and assert the `updateKit` mutation
 *                returns the edited values.
 *   4. PERSIST — reload the kit-info page and assert the edited values survived.
 *
 * This spec OWNS its records. Every device it creates is registered with the
 * UatGraphQLClient tracker and removed in afterAll — even if an assertion throws
 * mid-flow. The UAT test token has no delete authority (see helpers/graphql.ts),
 * so teardown ARCHIVES the device (archived: true), which drops it out of every
 * default list/detail view the UI shows. Archived cleanup is the accepted end
 * state for this token.
 *
 * Identity: the quick-create modal only captures type/make/model (no serialNo),
 * so the unique, searchable identifier for a run is the MODEL string
 * (`Kit E2E Sample <timestamp>`, see helpers/sample-data.ts). Two runs never
 * collide because the timestamp differs, and the suite runs fullyParallel:false,
 * so this file has the backend to itself while it writes.
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid bearer token.
 */
import { test, expect, Page } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { E2E_SAMPLE_MARKER, sampleName } from '../helpers/sample-data';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is missing/expired or is the CI-minted fake (mirrors the pattern
 * in teardown-helper.spec.ts).
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
 * UAT API rejects. Same interceptor the other real-UAT UI specs use — it makes
 * the app's own mutations hit live data while remaining observable to
 * waitForResponse. (waitForResponse still fires for a route.fulfill()ed
 * response, and the request postData is preserved for matching.)
 */
async function withAuthInterceptor(page: Page): Promise<void> {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    try {
      const safeHeaders = { ...route.request().headers() };
      // The UAT API rejects browser Origin + CORS fetch metadata; drop them so
      // the server-side forward reads as a same-origin call.
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

test.describe('Device intake write-flow (kit create → index → edit → persist)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    // The warm-up below may legitimately take ~2 min on an Azure cold start —
    // outlive the default 60s hook timeout or the hook dies before the loop.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    // The UAT backend (Azure App Service) cold-starts and the app shows a
    // "Server is starting up" overlay until it responds. Warm it up before
    // driving the UI so the create/edit flow isn't racing the spin-up. Poll a
    // trivial query until it succeeds (up to ~2 min).
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request(`query { kitsConnection(page: { size: 1 }) { totalElements } }`);
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
  });

  test.afterAll(async () => {
    // Safety net: dispose removes anything still tracked. A failed test may have
    // created a device without reaching an explicit cleanup — this archives it.
    await uat?.dispose();
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('creates a device, finds it in the index, edits it, and the edits persist', async ({ page }) => {
    test.setTimeout(90_000);
    await withAuthInterceptor(page);

    const stamp = Date.now();
    const uniqueModel = sampleName('Kit', stamp);
    const createMake = `Kit ${E2E_SAMPLE_MARKER} make ${stamp}`;
    const editedMake = `Kit ${E2E_SAMPLE_MARKER} make ${stamp} edited`;
    const editedModel = `${uniqueModel} edited`;

    // ── 1. CREATE via the kit-index quick-create modal ─────────────────────────
    await page.goto('/dashboard/devices');
    await page.getByTestId('kit-create-open').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('kit-create-open').click();

    // Modal formly form: type defaults to LAPTOP (kept — avoids the required
    // subStatus.network field that SMARTPHONE/COMMSDEVICE add on the edit page).
    await page.getByLabel('Device Make').fill(createMake);
    await page.getByLabel('Device Model').fill(uniqueModel);

    const createResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('quickCreateKit'),
      { timeout: 20_000 },
    );
    await page.getByTestId('kit-create-submit').click();
    const createRes = await createResponse;

    const createJson = await createRes.json();
    expect(createJson.errors, `create must not error: ${JSON.stringify(createJson.errors)}`).toBeFalsy();
    const created = createJson.data?.quickCreateKit;
    expect(created?.id, 'quickCreateKit must return a new device id').toBeTruthy();

    const kitId = String(created.id);
    // Register immediately so teardown removes it even if a later assertion throws.
    uat.track('kit', kitId);
    expect(created.model).toBe(uniqueModel);

    // ── 2. FIND it in the index by its unique model ────────────────────────────
    // The kit-index DataTables search maps to the `term` var, which the query
    // matches against model/serialNo/id/notes.
    const searchInput = page.locator('input[aria-controls="kit-index"]');
    await searchInput.waitFor({ state: 'visible', timeout: 15_000 });

    const row = page.locator('#kit-index tbody tr', { hasText: uniqueModel });

    // The UAT search index can lag slightly behind a just-created record: the
    // device exists, but a single search fired immediately after create can
    // still return zero rows because the index hasn't caught up yet. A plain
    // `toBeVisible({timeout})` only re-polls the *already-rendered* DOM — it
    // never re-issues the search — so a stale first response would hang until
    // timeout even though a later search would succeed. Retry the whole
    // round-trip (re-fill the search box, which re-triggers DataTables' own
    // debounced ajax call, then re-check) until the row appears or we give up.
    await expect(async () => {
      // Clear first so re-filling the same string is a genuine value change —
      // DataTables only re-searches when the input's value actually changes.
      // Then press Enter: clearing alone leaves the table showing the UNFILTERED
      // result set, and the refill's input event does not reliably re-trigger the
      // server-side query, so without this the retry can leave the term sitting
      // in the box against unfiltered rows and never recover.
      await searchInput.fill('');
      await searchInput.fill(uniqueModel);
      await searchInput.press('Enter');
      await expect(row, 'the created device should be findable in the index by its model').toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 3_000, 5_000] });

    // The Make column shows the make that was entered; the Model column shows the model.
    await expect(row).toContainText(createMake);
    await expect(row).toContainText(uniqueModel);

    // ── 3. EDIT on the kit-info page: change make + model, then Save ───────────
    await page.goto(`/dashboard/devices/${kitId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    // make/model are plain formly <input>s (always visible/editable, unlike the
    // kit-info-input fields which gate edits behind a confirm dialog).
    // `Make` is optional (label renders exactly "Make"); `Model` is required, so
    // its label renders "Model *" — match it non-exactly (substring).
    const makeInput = page.getByLabel('Make', { exact: true });
    const modelInput = page.getByLabel('Model');
    await expect(makeInput).toHaveValue(createMake, { timeout: 15_000 });
    await expect(modelInput).toHaveValue(uniqueModel);

    await makeInput.fill(editedMake);
    await modelInput.fill(editedModel);

    const updateResponse = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateKit'),
      { timeout: 20_000 },
    );
    await page.getByTestId('kit-save').click();
    const updateRes = await updateResponse;

    const updateJson = await updateRes.json();
    expect(updateJson.errors, `update must not error: ${JSON.stringify(updateJson.errors)}`).toBeFalsy();
    const updated = updateJson.data?.updateKit;
    expect(updated?.id, 'updateKit must return the device').toBe(kitId);
    expect(updated.make, 'updateKit response must carry the edited make').toBe(editedMake);
    expect(updated.model, 'updateKit response must carry the edited model').toBe(editedModel);

    // ── 4. PERSIST: reload the kit-info page and confirm the edits survived ─────
    await page.goto(`/dashboard/devices/${kitId}`);
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByLabel('Make', { exact: true })).toHaveValue(editedMake, { timeout: 15_000 });
    await expect(page.getByLabel('Model')).toHaveValue(editedModel);

    // ── 5. TEARDOWN: explicit cleanup here; afterAll dispose is the safety net.
    await uat.cleanup();

    // Confirm the device is out of the active view (archived, since the token
    // can't hard-delete). This also proves a repeat run won't trip over it.
    const after = await uat.request<{ kit: { id: string; archived: boolean } | null }>(
      `query ($id: Long) { kit(where: { id: { _eq: $id } }) { id archived } }`,
      { id: kitId },
    );
    expect(after.kit?.archived, 'device should be archived out of active views after teardown').toBe(true);
  });
});
