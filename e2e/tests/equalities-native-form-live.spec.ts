/**
 * Live-UAT end-to-end check of the native equalities form (plan F7, docs/equalities-native-form-plan.md).
 *
 * equalities-native-form.spec.ts (@mocked) pins the component against stubbed GraphQL. This spec
 * drives the REAL flow on the deployed UAT origin as an anonymous referee, to catch what the
 * mocked spec cannot: the deployed server's submitEqualities, its answer validation, the real
 * Google Sheets append with the UAT service account, and the request status change.
 *
 *   public request form -> createDeviceRequest -> native form (no Typeform request) -> 10 answers
 *   (benefits = Yes skips NRPF) -> submitEqualities = true -> thank-you -> nothing kept in the
 *   browser -> the request is PROCESSING_EQUALITIES_DATA_COMPLETE.
 *
 * @live-smoke: EXCLUDED BY DEFAULT (see playwright.config.uat.ts). It writes to UAT, and every
 * run appends one row to the UAT TEST spreadsheet ("TaDa equalities - UAT test"), which no
 * teardown can remove. The answers are fixed and synthetic; filter the Sheet on the Correlation
 * ID the spec logs. Never point it at production.
 *
 *   npx playwright test --config playwright.config.uat.ts equalities-native-form-live --grep @live-smoke
 *
 * Needs: `native-equalities-form` ON in UAT (the spec skips, saying so, when it is off) and a
 * fresh UAT token (e2e/save-token.mjs) for the status check and the teardown.
 *
 * Referee: the spec creates its own sample organisation and referee over the API. A shared seeded
 * referee fills up: the public form refuses a referee with 5 open requests in an area, and a
 * request this spec abandons mid-run stays open until the 20-minute sweep declines it.
 *
 * CLEANUP: teardown hard-deletes the request, then the referee, then the organisation. All three
 * carry E2E_SAMPLE_MARKER, so `npm run e2e:cleanup` also finds them if teardown could not run.
 */
import { expect, Page, test } from '@playwright/test';
import { UatGraphQLClient, UAT_GRAPHQL_ENDPOINT } from '../helpers/graphql';
import { advancePastLocationStep } from '../helpers/location-step';
import { sampleEmail, sampleName } from '../helpers/sample-data';

/** Fixed synthetic answers, one per screen. benefits = Yes, so NRPF is never shown. */
const ANSWERS = [
  'Food bank',
  '25-34',
  'Prefer not to say',
  'Bisexual',
  'Yes',
  'No',
  'White',
  'Tenant (private housing)',
  'Enrolled but not started',
  'Yes - part time',
];

/** The heading carries a screen-reader prefix ("Question 5 of 11: ") that changes when the
 *  question count does (benefits = Yes drops it to 10) before the screen advances. */
const questionText = (t: string | null) => (t ?? '').replace(/^\s*Question \d+ of \d+:\s*/, '').trim();

async function answer(page: Page, choice: string): Promise<void> {
  const title = page.getByTestId('question-title');
  const before = questionText(await title.textContent());
  await page.getByRole('radio', { name: choice, exact: false }).first().click();
  await expect
    .poll(async () => questionText(await title.textContent()) !== before || (await page.getByTestId('submit').count()) > 0, {
      message: `the form did not move on after "${choice}" on "${before}"`,
    })
    .toBe(true);
}

test.describe('native equalities form, live on UAT @live-smoke', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let uat: UatGraphQLClient;
  test.beforeAll(async () => {
    uat = await UatGraphQLClient.create();
  });
  test.afterAll(async () => {
    await uat?.cleanup();
  });

  test('a request completes its equalities step through the native form and the Sheet', async ({ page, request }) => {
    test.setTimeout(240_000);

    const flags = await request.post(UAT_GRAPHQL_ENDPOINT, { data: { query: '{ featureFlagsPublic { key enabled } }' } });
    const on = ((await flags.json()).data?.featureFlagsPublic ?? []).some(
      (f: { key: string; enabled: boolean }) => f.key === 'native-equalities-form' && f.enabled,
    );
    test.skip(!on, 'native-equalities-form is OFF in UAT: switch it on in Admin -> Feature flags to run this spec');

    const typeformRequests: string[] = [];
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname;
      if (host === 'typeform.com' || host.endsWith('.typeform.com')) typeformRequests.push(req.url());
    });
    const created = page.waitForResponse(
      (res) => res.url() === UAT_GRAPHQL_ENDPOINT && (res.request().postData() ?? '').includes('createDeviceRequest'),
      { timeout: 120_000 },
    );
    const submitted = page.waitForResponse(
      (res) => res.url() === UAT_GRAPHQL_ENDPOINT && (res.request().postData() ?? '').includes('submitEqualities'),
      { timeout: 120_000 },
    );

    // Fixtures: a sample organisation and referee owned by this run.
    const stamp = Date.now();
    const orgName = sampleName('Org', stamp);
    const refereeEmail = sampleEmail('Referee', stamp);
    const { createReferringOrganisation: org } = await uat.request<{ createReferringOrganisation: { id: string } }>(
      'mutation ($data: CreateReferringOrganisationInput!) { createReferringOrganisation(data: $data) { id } }',
      { data: { name: orgName, website: null, phoneNumber: null } },
    );
    uat.track('referringOrganisation', org.id);
    const { createReferringOrganisationContact: contact } = await uat.request<{
      createReferringOrganisationContact: { id: string };
    }>('mutation ($data: CreateReferringOrganisationContactInput!) { createReferringOrganisationContact(data: $data) { id } }', {
      data: {
        fullName: sampleName('Referee', stamp),
        email: refereeEmail,
        phoneNumber: '07700900000',
        address: '1 Test Street, London',
        referringOrganisation: org.id,
      },
    });
    uat.track('referringOrganisationContact', contact.id);

    // The request: postcode -> organisation -> referee email -> a laptop.
    await page.goto('/organisation-device-request', { timeout: 120_000 });
    await advancePastLocationStep(page);
    const orgInput = page.locator('form-choice ng-select input');
    await expect(orgInput).toBeVisible({ timeout: 60_000 });
    await orgInput.fill(orgName);
    await page.locator('.ng-option', { hasText: orgName }).first().click({ timeout: 30_000 });
    await page.getByPlaceholder('Your email address').fill(refereeEmail);
    await page.getByRole('button', { name: 'Find Email' }).click();
    await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 30_000 });

    const form = page.locator('formly-form');
    await form.getByText('Laptop', { exact: true }).click();
    await form.locator('textarea').fill('Automated live-UAT test of the native equalities form. No real client.');
    await page.getByLabel("For your records, enter your client's initials or a client reference").fill(sampleName('Request', stamp));
    await page.getByRole('button', { name: 'Next' }).click();

    const { data: createData } = await (await created).json();
    const requestId: string = createData.createDeviceRequest.id;
    const correlationId: string = createData.createDeviceRequest.correlationId;
    uat.track('deviceRequest', requestId);
    console.info(`[equalities-live] request ${requestId}, Sheet row Correlation ID ${correlationId}`);

    // The native form replaces Typeform.
    await expect(page.getByTestId('equalities-form')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#tf-form')).toHaveCount(0);

    await page.getByTestId('start').click();
    for (const choice of ANSWERS) {
      if (choice === 'No') await expect(page.getByTestId('question-title')).toContainText('disability');
      await answer(page, choice);
    }
    await page.getByTestId('submit').click();

    const reply = await (await submitted).json();
    expect(reply.errors, `submitEqualities refused: ${JSON.stringify(reply.errors)}`).toBeUndefined();
    expect(reply.data.submitEqualities).toBe(true);
    await expect(page.getByTestId('thank-you')).toBeVisible({ timeout: 30_000 });

    // No third-party script on the page, and no answer kept in the browser.
    expect(typeformRequests).toEqual([]);
    const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    for (const choice of ['Food bank', 'Bisexual', 'Tenant (private housing)', 'Yes - part time']) {
      expect(kept).not.toContain(choice);
    }

    // The server completed the step only after the Sheet accepted the row.
    const { deviceRequest } = await uat.request<{ deviceRequest: { status: string } | null }>(
      'query ($id: Long) { deviceRequest(where: { id: { _eq: $id } }) { status } }',
      { id: Number(requestId) },
    );
    expect(deviceRequest?.status).toBe('PROCESSING_EQUALITIES_DATA_COMPLETE');
  });
});
