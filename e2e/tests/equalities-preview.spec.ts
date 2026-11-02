/**
 * Mocked coverage for the equalities-form prototype (equalities-preview.component.ts).
 *
 * Pins the behaviour the demo exists to show:
 *   - the unlisted route renders anonymously, with the prototype banner;
 *   - one question per screen, choosing auto-advances;
 *   - the Typeform logic jump: benefits = "Yes" skips the No-Recourse-to-Public-Funds question;
 *   - hidden fields (?corr_id/borough/ward) flow through to the would-be payload;
 *   - NOTHING is sent: no GraphQL request carries an answer, and no answer reaches storage.
 *
 * @mocked — no token, all GraphQL stubbed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const ROUTE = '/preview/equalities-491d341f15';

async function stubGraphql(page: Page, seenBodies: string[]): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    seenBodies.push(body);
    const data = body.includes('featureFlagsPublic')
      ? { featureFlagsPublic: [] }
      : body.includes('buildInfo')
        ? { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } }
        : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}

async function answer(page: Page, choice: string): Promise<void> {
  const title = await page.getByTestId('question-title').textContent();
  await page.getByRole('radio', { name: choice, exact: false }).first().click();
  // Auto-advance: wait for the next question (or stay put on the last one).
  await expect
    .poll(async () => (await page.getByTestId('question-title').textContent()) !== title || (await page.getByTestId('submit').count()) > 0)
    .toBe(true);
}

test.describe('equalities form prototype @mocked', () => {
  test('walks the form, applies the benefits skip, and sends nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const bodies: string[] = [];
    const otherRequests: string[] = [];
    await stubGraphql(page, bodies);
    page.on('request', (r) => {
      if (['POST', 'PUT', 'PATCH'].includes(r.method()) && !r.url().includes('/graphql')) otherRequests.push(r.url());
    });

    await page.goto(`${ROUTE}?corr_id=12345&borough=Lambeth&ward=Brixton%20Acre%20Lane`);
    await expect(page.getByTestId('prototype-banner')).toContainText('not saved or sent anywhere', { timeout: 15_000 });
    await page.getByTestId('start').click();

    await expect(page.getByTestId('question-title')).toContainText('What type of organisation are you?');
    await answer(page, 'Food bank');
    await answer(page, '25-34');
    await answer(page, 'Prefer not to say');
    await answer(page, 'Bisexual');
    // Benefits = Yes → Typeform jumps past the NRPF question straight to disability.
    await answer(page, 'Yes');
    await expect(page.getByTestId('question-title')).toContainText('disability');
    await expect(page.locator('.counter')).toContainText('/ 10');
    await answer(page, 'No');
    await answer(page, 'White');
    await answer(page, 'Tenant (private housing)');
    await answer(page, 'Enrolled but not started');
    await answer(page, 'Yes - part time');
    await page.getByTestId('submit').click();

    await expect(page.getByTestId('thank-you')).toBeVisible();
    await page.getByTestId('payload').locator('summary').click();
    const payload = page.getByTestId('payload');
    await expect(payload).toContainText('12345');
    await expect(payload).toContainText('Brixton Acre Lane');
    await expect(payload).toContainText('Bisexual');
    await expect(payload).not.toContainText('No Recourse');

    // Special category answers must not leave the browser or land in storage.
    expect(bodies.filter((b) => b.includes('Bisexual') || b.includes('Food bank'))).toEqual([]);
    expect(otherRequests).toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('Bisexual');
  });

  test('benefits other than Yes still asks the NRPF question', async ({ page }) => {
    test.setTimeout(60_000);
    await stubGraphql(page, []);
    await page.goto(ROUTE);
    await page.getByTestId('start').click();
    await answer(page, 'Library');
    await answer(page, '65+');
    await answer(page, 'Male (including trans man)');
    await answer(page, 'Asexual');
    await answer(page, 'No');
    await expect(page.getByTestId('question-title')).toContainText('No Recourse to Public Funds');
    await expect(page.locator('.counter')).toContainText('/ 11');
  });

  test('keyboard: letter keys choose, Enter starts', async ({ page }) => {
    test.setTimeout(60_000);
    await stubGraphql(page, []);
    await page.goto(ROUTE);
    await expect(page.getByTestId('welcome')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('question-title')).toContainText('organisation');
    await page.keyboard.press('d'); // D = Food bank
    await expect(page.getByTestId('question-title')).toContainText('age');
  });
});
