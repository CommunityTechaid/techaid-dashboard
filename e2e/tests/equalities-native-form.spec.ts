/**
 * The native equalities form on the public request form (equalities-form.component.ts), which
 * replaces the equalities Typeform (f93D0s88) while the `native-equalities-form` flag is on.
 *
 * Pins:
 *   - flag ON: after createDeviceRequest the native form shows, and embed.typeform.com is never
 *     contacted (the third-party script must not share a page with the answers);
 *   - one question per screen, choosing auto-advances, letter keys and Enter work;
 *   - the Typeform logic jump: benefits = "Yes" skips the No-Recourse-to-Public-Funds question;
 *   - the submitEqualities payload: the request's correlationId, the ward, and exactly the answers
 *     to the questions shown;
 *   - a Sheet failure keeps the answers and Try again re-sends them; a "request not found" refusal
 *     is final; no answer reaches browser storage;
 *   - flag OFF: the Typeform embed is used exactly as before.
 *
 * @mocked: all GraphQL and Typeform stubbed, no token needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { advancePastLocationStep } from '../helpers/location-step';

const AUTH0_ORIGIN = '**://techaid-auth.eu.auth0.com/**';
const TYPEFORM_ORIGIN = '**://embed.typeform.com/**';
const CORRELATION_ID = '8812345678901234567';

type SubmitReply = (route: Route, attempt: number) => Promise<void>;

interface SentAnswer {
  key: string;
  choice: string;
}

interface SentSubmission {
  correlationId: string;
  ward: string | null;
  answers: SentAnswer[];
}

interface Captured {
  submits: SentSubmission[];
  typeformRequests: string[];
}

const ok: SubmitReply = (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { submitEqualities: true } }) });

const refusal = (code: string, message: string, classification = 'BAD_REQUEST'): SubmitReply => (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ errors: [{ message, extensions: { classification, code, ref: 'E2EREF42' } }], data: null }),
  });

async function installMocks(page: Page, nativeFlag: boolean, reply: SubmitReply = ok): Promise<Captured> {
  const captured: Captured = { submits: [], typeformRequests: [] };

  page.on('request', (req) => {
    if (new URL(req.url()).hostname.endsWith('typeform.com')) captured.typeformRequests.push(req.url());
  });
  await page.route(AUTH0_ORIGIN, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stub</body></html>' }),
  );
  await page.route(TYPEFORM_ORIGIN, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tf = { createWidget: function () {} };' }),
  );

  await page.route('**/graphql', async (route) => {
    const raw = route.request().postData() ?? '';
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (raw.includes('submitEqualities')) {
      captured.submits.push(JSON.parse(raw).variables.data);
      return reply(route, captured.submits.length);
    }
    if (raw.includes('buildInfo')) {
      return json({ data: { buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({ data: { featureFlagsPublic: [{ key: 'native-equalities-form', enabled: nativeFlag }] } });
    }
    if (raw.includes('boroughAvailabilityPublic')) {
      const everything = ['laptops', 'desktops', 'tablets', 'phones', 'allInOnes', 'commsDevices', 'broadbandHubs', 'other'];
      return json({
        data: { boroughAvailabilityPublic: [{ borough: 'Southwark', offered: everything, maxPerReferee: 3, unresolvedAuto: [] }] },
      });
    }
    if (raw.includes('adminConfig')) {
      return json({
        data: {
          adminConfig: {
            canPublicRequestSIMCard: true,
            canPublicRequestLaptop: true,
            canPublicRequestPhone: true,
            canPublicRequestBroadbandHub: true,
            canPublicRequestTablet: true,
            canPublicRequestDesktop: true,
          },
        },
      });
    }
    if (raw.includes('findContent')) {
      return json({ data: { post: { id: '1', content: '<p>E2E public request page content</p>' } } });
    }
    if (raw.includes('findAutocompleteReferringOrgs')) {
      return json({ data: { referringOrganisationsPublic: [{ id: 'org-1', name: 'E2E Test Org' }] } });
    }
    if (raw.includes('findOrganisationContact')) {
      return json({ data: { referringOrganisationContactsPublic: [{ id: 'contact-1', fullName: 'E2E Contact' }] } });
    }
    if (raw.includes('createDeviceRequest')) {
      return json({ data: { createDeviceRequest: { id: '4242', correlationId: CORRELATION_ID, membershipGraceIndex: null } } });
    }
    return json({ data: {} });
  });

  return captured;
}

/** Postcode -> org -> email -> device request, submitted. Ends on the equalities step. */
async function createRequest(page: Page): Promise<void> {
  await page.goto('/organisation-device-request');
  await expect(page.getByText('E2E public request page content')).toBeVisible({ timeout: 30_000 });
  await advancePastLocationStep(page);

  const orgSelectInput = page.locator('form-choice ng-select input');
  await expect(orgSelectInput).toBeVisible({ timeout: 15_000 });
  await orgSelectInput.fill('E2E');
  const orgOption = page.locator('.ng-option', { hasText: 'E2E Test Org' });
  await expect(orgOption).toBeVisible({ timeout: 15_000 });
  await orgOption.click();

  await page.getByPlaceholder('Your email address').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Find Email' }).click();
  await expect(page.getByText('Please select the item your client needs.')).toBeVisible({ timeout: 15_000 });

  const form = page.locator('formly-form');
  await form.getByText('Laptop', { exact: true }).click();
  await form.locator('textarea').fill('E2E test request, no identifiable details.');
  await page.getByLabel("For your records, enter your client's initials or a client reference").fill('E2E-1');
  await page.getByRole('button', { name: 'Next' }).click();
}

async function answer(page: Page, choice: string): Promise<void> {
  const title = await page.getByTestId('question-title').textContent();
  await page.getByRole('radio', { name: choice, exact: false }).first().click();
  // Auto-advance: wait for the next question (or stay put on the last one).
  await expect
    .poll(async () => (await page.getByTestId('question-title').textContent()) !== title || (await page.getByTestId('submit').count()) > 0)
    .toBe(true);
}

/** Every question, with benefits = Yes so NRPF is skipped (10 questions). */
async function answerAllSkippingNrpf(page: Page): Promise<void> {
  await page.getByTestId('start').click();
  await expect(page.getByTestId('question-title')).toContainText('What type of organisation are you?');
  await answer(page, 'Food bank');
  await answer(page, '25-34');
  await answer(page, 'Prefer not to say');
  await answer(page, 'Bisexual');
  await answer(page, 'Yes');
  await expect(page.getByTestId('question-title')).toContainText('disability');
  await expect(page.locator('.counter')).toContainText('/ 10');
  await answer(page, 'No');
  await answer(page, 'White');
  await answer(page, 'Tenant (private housing)');
  await answer(page, 'Enrolled but not started');
  await answer(page, 'Yes - part time');
}

async function storageText(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
}

test.describe('native equalities form @mocked', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('flag on: the native form replaces Typeform and sends the answers once', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, true);
    await createRequest(page);

    await expect(page.getByTestId('equalities-form')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#tf-form')).toHaveCount(0);

    await answerAllSkippingNrpf(page);
    await page.getByTestId('submit').click();
    await expect(page.getByTestId('thank-you')).toBeVisible();

    expect(captured.submits).toHaveLength(1);
    const [sent] = captured.submits;
    expect(sent.correlationId).toBe(CORRELATION_ID);
    expect(typeof sent.ward === 'string' && sent.ward.length > 0).toBe(true);
    expect(sent.answers).toHaveLength(10);
    expect(sent.answers.map((a) => a.key)).not.toContain('noRecourseToPublicFunds');
    expect(sent.answers).toContainEqual({ key: 'sexualOrientation', choice: 'Bisexual' });
    expect(sent.answers).toContainEqual({ key: 'stateBenefits', choice: 'Yes' });

    // The third-party script never loads on this page, and no answer is kept in the browser.
    expect(captured.typeformRequests).toEqual([]);
    expect(await storageText(page)).not.toContain('Bisexual');
  });

  test('benefits other than Yes still asks the NRPF question', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, true);
    await createRequest(page);
    await page.getByTestId('start').click();
    await answer(page, 'Library');
    await answer(page, '65+');
    await answer(page, 'Male (including trans man)');
    await answer(page, 'Asexual');
    await answer(page, 'No');
    await expect(page.getByTestId('question-title')).toContainText('No Recourse to Public Funds');
    await expect(page.locator('.counter')).toContainText('/ 11');
  });

  test('keyboard: Enter starts, letter keys choose', async ({ page }) => {
    test.setTimeout(90_000);
    await installMocks(page, true);
    await createRequest(page);
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('welcome').locator('h1').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('question-title')).toContainText('organisation');
    await page.keyboard.press('d'); // D = Food bank
    await expect(page.getByTestId('question-title')).toContainText('age');
  });

  test('a Sheet failure keeps the answers, and Try again re-sends them', async ({ page }) => {
    test.setTimeout(90_000);
    const sheetDownOnce: SubmitReply = (route, attempt) =>
      attempt === 1
        ? refusal('EQUALITIES_SHEET_UNAVAILABLE', "We couldn't save your answers just now. Please try again in a minute.", 'INTERNAL_ERROR')(route, attempt)
        : ok(route, attempt);
    const captured = await installMocks(page, true, sheetDownOnce);
    await createRequest(page);
    await answerAllSkippingNrpf(page);
    await page.getByTestId('submit').click();

    const error = page.getByTestId('equalities-error');
    await expect(error).toContainText("We couldn't save your answers just now");
    // The ref the dashboard sent as X-CTA-Ref (the real server echoes the same one back).
    await expect(page.getByTestId('equalities-error-ref')).toHaveText(/^Reference: [A-Z0-9]{8}$/);
    await page.getByTestId('equalities-retry').click();
    await expect(page.getByTestId('thank-you')).toBeVisible();

    expect(captured.submits).toHaveLength(2);
    expect(captured.submits[1]).toEqual(captured.submits[0]);
  });

  test('a request that can no longer be matched is a final message, with no retry', async ({ page }) => {
    test.setTimeout(90_000);
    const message = "We couldn't match these answers to your request. It may have timed out - please contact distributions@communitytechaid.org.uk.";
    await installMocks(page, true, refusal('EQUALITIES_REQUEST_NOT_FOUND', message));
    await createRequest(page);
    await answerAllSkippingNrpf(page);
    await page.getByTestId('submit').click();

    await expect(page.getByTestId('equalities-error')).toContainText("couldn't match these answers");
    await expect(page.getByTestId('equalities-retry')).toHaveCount(0);
  });

  test('flag off: the Typeform embed is used as before', async ({ page }) => {
    test.setTimeout(90_000);
    const captured = await installMocks(page, false);
    await createRequest(page);

    await expect(page.locator('#tf-form')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('equalities-form')).toHaveCount(0);
    expect(captured.typeformRequests.some((url) => url.includes('/next/embed.js'))).toBe(true);
    expect(captured.submits).toEqual([]);
  });
});
