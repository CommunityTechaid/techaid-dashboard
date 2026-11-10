/**
 * Live-UAT release pass: the checks a person would otherwise click through before a release.
 *
 * WHY: the mocked suite proves each change against stubbed data. Before the 2.4.0 release
 * (2026-11-10) four changes had no check against the deployed build and real data: DataTables 3
 * (#332), Formly 11 (#329), the address suggestions fix (#328) and the battery colour bands
 * (#313). This spec is that check, so it can be re-run before any later release instead of
 * being repeated by hand.
 *
 *   1. Index tables (devices, requests, organisations, donors) at desktop and phone width:
 *      rows load, the page-length menu, paging, sorting and search all work.
 *   2. Public request form (the only form with hidden Formly fields), walked anonymously up to
 *      the final button. NOTHING IS SUBMITTED: the button is never clicked, and
 *      createDeviceRequest is blocked at the network as a second guard.
 *   3. Kit form: the Battery Health colour bands and a number field, edited but never saved
 *      (updateKit is blocked at the network).
 *   4. Address suggestions in the Create Referee and New Individual Donor forms, against the
 *      real Places proxy: they appear with no extra keystroke and close on blur.
 *
 * Writes: test 2 creates one organisation and one referee through the API (named
 * "… E2E Sample <timestamp>") so the form has a referee with no request history; the teardown
 * archives both. Everything else is read-only.
 *
 * Not tagged @mocked: needs the UAT backend and a valid bearer token.
 * Run against the deployed build (real CSP, production bundle):
 *   npx playwright test --config playwright.config.uat.ts uat-release-pass
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { sampleEmail, sampleName } from '../helpers/sample-data';

function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') {
    return 'CI fake token — the live release pass needs a real UAT token';
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

/** Fails the test if the browser reports a CSP violation (only the deployed build sends a CSP). */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', msg => {
    if (/Content Security Policy|EvalError|unsafe-eval/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  return violations;
}

/** Blocks one GraphQL mutation at the network and counts the attempts. */
async function blockMutation(page: Page, operation: string): Promise<{ attempts: () => number }> {
  let attempts = 0;
  await page.route('**/graphql', async route => {
    if ((route.request().postData() ?? '').includes(operation)) {
      attempts++;
      return route.abort();
    }
    return route.fallback();
  });
  return { attempts: () => attempts };
}

// ── 1. Index tables ─────────────────────────────────────────────────────────────────────────

interface TableCase {
  name: string;
  path: string;
  id: string;
  /** Index of the column the table is ordered by on load (descending). */
  orderColumn: number;
}

const TABLES: TableCase[] = [
  { name: 'devices', path: '/dashboard/devices', id: 'kit-index', orderColumn: 1 },
  { name: 'requests', path: '/dashboard/device-requests', id: 'device-request-index', orderColumn: 0 },
  { name: 'organisations', path: '/dashboard/referring-organisations', id: 'referring-org-index', orderColumn: 6 },
  { name: 'donors', path: '/dashboard/donors', id: 'donor-index', orderColumn: 5 },
];

const VIEWPORTS = [
  { name: 'desktop', size: { width: 1366, height: 900 } },
  { name: 'phone', size: { width: 390, height: 844 } },
];

const INFO = /Showing ([\d,]+) to ([\d,]+) of ([\d,]+)/;

async function readInfo(info: Locator): Promise<{ from: number; to: number; total: number }> {
  const m = ((await info.textContent()) ?? '').match(INFO);
  if (!m) {
    throw new Error(`table info text not understood: "${await info.textContent()}"`);
  }
  const n = (s: string) => Number(s.replace(/,/g, ''));
  return { from: n(m[1]), to: n(m[2]), total: n(m[3]) };
}

test.describe('release pass: index tables on live UAT', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  for (const viewport of VIEWPORTS) {
    for (const table of TABLES) {
      test(`${table.name} table at ${viewport.name} width: page length, paging, sort, search`, async ({ page }) => {
        test.setTimeout(180_000);
        const csp = watchCsp(page);
        await page.setViewportSize(viewport.size);
        await page.goto(table.path);

        const wrapper = page.locator(`#${table.id}_wrapper`);
        // Data rows only: an empty result is one placeholder row (DataTables' own, or the
        // template's "No data!" row on the devices and donors tables).
        const rows = page.locator(`#${table.id} tbody tr:not(:has(td.dt-empty, td.no-data-available))`);
        const info = wrapper.locator('.dt-info');
        const lengthMenu = wrapper.locator('.dt-length select');
        const search = wrapper.locator('.dt-search input');

        // Loaded: default page of 10 (or everything, if UAT holds fewer).
        await expect(info).toContainText(/Showing 1 to/, { timeout: 120_000 });
        const { total } = await readInfo(info);
        expect(total, 'UAT should hold at least one row').toBeGreaterThan(0);
        await expect(rows).toHaveCount(Math.min(10, total));

        // The controls are on screen and not clipped off the side of the viewport.
        for (const [label, control] of [['page-length menu', lengthMenu], ['search box', search]] as const) {
          await control.scrollIntoViewIfNeeded();
          await expect(control, label).toBeVisible();
          const box = await control.boundingBox();
          expect.soft(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
          expect.soft(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport.size.width);
        }

        // Page length.
        await lengthMenu.selectOption('25');
        await expect(info).toContainText(`Showing 1 to ${Math.min(25, total)} of`, { timeout: 60_000 });
        await expect(rows).toHaveCount(Math.min(25, total));
        await lengthMenu.selectOption('5');
        await expect(info).toContainText(`Showing 1 to ${Math.min(5, total)} of`, { timeout: 60_000 });
        await expect(rows).toHaveCount(Math.min(5, total));

        // Paging.
        if (total > 5) {
          const firstRowBefore = await rows.first().innerText();
          const next = wrapper.locator('.dt-paging button.page-link.next');
          await next.scrollIntoViewIfNeeded();
          await next.click();
          await expect(info).toContainText(`Showing 6 to ${Math.min(10, total)} of`, { timeout: 60_000 });
          await expect(rows.first()).not.toHaveText(firstRowBefore, { useInnerText: true });
          await wrapper.locator('.dt-paging button.page-link.previous').click();
          await expect(info).toContainText('Showing 1 to', { timeout: 60_000 });
        }

        // Sorting: the default-ordered column flips from descending to ascending.
        const header = page.locator(`#${table.id} thead th`).nth(table.orderColumn);
        await expect(header).toHaveAttribute('aria-sort', 'descending');
        const firstRowDescending = await rows.first().innerText();
        await header.scrollIntoViewIfNeeded();
        await header.click();
        await expect(header).toHaveAttribute('aria-sort', 'ascending', { timeout: 60_000 });
        await expect(info).toContainText('Showing 1 to', { timeout: 60_000 });
        if (total > 5) {
          await expect(rows.first()).not.toHaveText(firstRowDescending, { timeout: 60_000, useInnerText: true });
        }

        // Search (the box only searches on Enter): nothing matches, then the full list returns.
        await search.scrollIntoViewIfNeeded();
        await search.fill('zzqxj-no-such-row');
        await search.press('Enter');
        await expect(rows).toHaveCount(0, { timeout: 60_000 });
        await search.fill('');
        await search.press('Enter');
        await expect(info).toContainText(`of ${total.toLocaleString('en-GB')} `, { timeout: 60_000 });
        await expect(rows).toHaveCount(Math.min(5, total));

        expect(csp, 'CSP violations').toEqual([]);
      });
    }
  }
});

// ── 2. Public request form ──────────────────────────────────────────────────────────────────

const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark

test.describe('release pass: public request form on live UAT (nothing submitted)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');
  // Anonymous, as a referrer sees it.
  test.use({ storageState: { cookies: [], origins: [] } });

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    uat = await UatGraphQLClient.create();
  });

  test.afterAll(async () => {
    await uat?.dispose();
  });

  test('postcode → organisation → referee → request page, hidden fields stay hidden', async ({ page }) => {
    test.setTimeout(240_000);
    const csp = watchCsp(page);
    const create = await blockMutation(page, 'createDeviceRequest');

    // A referee with no request history, so no request cap or membership limit is in the way.
    const stamp = Date.now();
    const orgName = sampleName('Org', stamp);
    const email = sampleEmail('Referee', stamp);
    const { createReferringOrganisation: org } = await uat.request<{ createReferringOrganisation: { id: string } }>(
      `mutation ($data: CreateReferringOrganisationInput!) { createReferringOrganisation(data: $data) { id } }`,
      { data: { name: orgName, website: null, phoneNumber: null } },
    );
    uat.track('referringOrganisation', org.id);
    const { createReferringOrganisationContact: contact } = await uat.request<{
      createReferringOrganisationContact: { id: string };
    }>(
      `mutation ($data: CreateReferringOrganisationContactInput!) { createReferringOrganisationContact(data: $data) { id } }`,
      {
        data: {
          fullName: sampleName('Referee', stamp),
          email,
          phoneNumber: '07700900000',
          address: '1 Test Street, London',
          referringOrganisation: org.id,
        },
      },
    );
    uat.track('referringOrganisationContact', contact.id);

    await page.goto('/organisation-device-request');

    // Location step.
    await expect(page.locator('#postcode')).toBeVisible({ timeout: 150_000 });
    await page.locator('#postcode').fill(COVERED_POSTCODE);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Submit a request' }).click();

    // Before an organisation is chosen the later sections are hidden Formly fields.
    const orgSelectInput = page.locator('form-choice ng-select input');
    await expect(orgSelectInput).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Please select the item your client needs.')).toHaveCount(0);
    await expect(page.getByPlaceholder('Your email address')).toHaveCount(0);

    // Organisation, then referee email.
    await orgSelectInput.fill(orgName);
    const orgOption = page.locator('.ng-option', { hasText: orgName });
    await expect(orgOption).toBeVisible({ timeout: 30_000 });
    await orgOption.click();
    await page.getByPlaceholder('Your email address').fill(email);
    await page.getByRole('button', { name: 'Find Email' }).click();

    // Request page: revealed fields are usable, the outcome pages stay hidden.
    await expect(page.getByText('Please select the item your client needs.').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Thank You')).toHaveCount(0);
    await expect(page.getByText('Oops!')).toHaveCount(0);
    await expect(page.getByPlaceholder('Your email address')).toHaveCount(0);

    const itemChoices = page.locator('formly-form input[type="radio"]');
    await expect(itemChoices.first()).toBeVisible();
    await itemChoices.first().check();
    await expect(itemChoices.first()).toBeChecked();

    const details = page.getByPlaceholder('Please do not include any identifiable details');
    await details.fill('E2E release pass: not submitted');
    await expect(details).toHaveValue('E2E release pass: not submitted');

    await expect(page.getByTestId('request-fieldset')).not.toHaveAttribute('disabled');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();

    expect(create.attempts(), 'createDeviceRequest must never be sent').toBe(0);
    expect(csp, 'CSP violations').toEqual([]);
  });
});

// ── 3. Kit form ─────────────────────────────────────────────────────────────────────────────

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(255, 0, 0)';

test.describe('release pass: kit form on live UAT (nothing saved)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  test('Battery Health colour bands and a number field on a real laptop', async ({ page }) => {
    test.setTimeout(180_000);
    const csp = watchCsp(page);
    await blockMutation(page, 'updateKit');

    const uat = await UatGraphQLClient.create();
    let kitId: string;
    try {
      const data = await uat.request<{ kitsConnection: { content: { id: string }[] } }>(
        `query { kitsConnection(page: { size: 1 }, where: { type: { _eq: LAPTOP }, archived: { _eq: false } }) { content { id } } }`,
      );
      kitId = data.kitsConnection.content[0]?.id;
    } finally {
      await uat.dispose();
    }
    expect(kitId, 'UAT should hold a non-archived laptop').toBeTruthy();

    await page.goto(`/dashboard/devices/${kitId}`);
    await page.locator('formly-form').first().waitFor({ state: 'visible', timeout: 120_000 });

    const battery = page.locator('formly-field-kit-info-input').filter({ hasText: 'Battery Health' });
    const box = battery.locator('.kit-info-input');
    await expect(box).toBeVisible({ timeout: 30_000 });

    // The input is only shown in edit mode, and leaving it (focusout) ends edit mode, so each
    // value is its own edit: pencil, confirm, type, leave.
    const edit = async (field: Locator, value: string) => {
      await field.locator('i.fa-edit').click();
      await page.getByRole('button', { name: 'YES, EDIT' }).click();
      const input = field.locator('input');
      await expect(input).toBeVisible();
      await input.fill(value);
      await input.blur();
      await expect(input).toBeHidden();
    };

    for (const [value, colour] of [['51', GREEN], ['50', RED], ['', RED], ['100', GREEN]] as const) {
      await edit(battery, value);
      await expect(box, `battery "${value}"`).toHaveCSS('background-color', colour);
    }
    await expect(box).toContainText('100');

    // A plain number field (Capacity, GB) takes a number and shows it back.
    const capacity = page.locator('formly-field-kit-info-input').filter({ hasText: 'Capacity' }).first();
    await edit(capacity, '512');
    await expect(capacity.locator('.kit-info-input')).toContainText('512');

    expect(csp, 'CSP violations').toEqual([]);
  });
});

// ── 4. Address suggestions ──────────────────────────────────────────────────────────────────

test.describe('release pass: address suggestions on live UAT (#328)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  const FORMS = [
    { name: 'Create Referee', path: '/dashboard/referring-organisation-contacts', open: 'Create Referee' },
    { name: 'New Individual Donor', path: '/dashboard/donors', open: 'Create Individual Donor' },
  ];

  for (const form of FORMS) {
    test(`${form.name}: suggestions appear while typing and close on blur`, async ({ page }) => {
      test.setTimeout(180_000);
      const csp = watchCsp(page);
      await page.goto(form.path);
      await expect(page.locator('.dt-info').first()).toContainText(/Showing/, { timeout: 120_000 });

      await page.getByText(form.open, { exact: true }).click();
      const input = page.locator('.modal form-place input');
      await expect(input).toBeVisible({ timeout: 30_000 });
      const items = page.locator('.modal form-place li.list-group-item');

      await input.click();
      await input.pressSequentially('10 Downing St', { delay: 40 });
      // No further input: the list must appear from the proxy's answer alone.
      await expect(items.first()).toBeVisible({ timeout: 15_000 });
      await expect(items.first()).toContainText(/Downing/i);

      // Blur in script: a click elsewhere would itself trigger change detection.
      await input.evaluate((el: HTMLInputElement) => el.blur());
      await expect(items).toHaveCount(0, { timeout: 5_000 });

      expect(csp, 'CSP violations').toEqual([]);
    });
  }
});
