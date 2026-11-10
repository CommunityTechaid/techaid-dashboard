/**
 * Live-UAT check of the organisation Allowance filter and History tab (dashboard #331,
 * techaid-server #363), replacing the manual click-through.
 *
 * 1. Organisations > Filter > "Filter by Allowance": for each option, every row shown carries a
 *    usage badge that fits the option, and the API's own numbers for those organisations agree.
 *    Read-only. An option with no organisation in UAT is recorded as an annotation, not skipped.
 * 2. Organisation page > History: creates its OWN organisation through the API (an "Org E2E
 *    Sample <timestamp>", tracked for teardown: hard-deleted, or archived if the token cannot
 *    delete), changes its tier in the UI, saves, and checks the new top row of History. Never
 *    edits a pre-existing organisation.
 * 3. Permission gate. The UI half (no History tab and no audit query without app:admin /
 *    admin:organisations) is proven by the @mocked spec org-allowance-filter-and-history.spec.ts
 *    ("detail: no History tab, and no audit query, without an admin permission"); the saved
 *    token is an admin, so it cannot be re-proven live here. What this spec checks live is that
 *    the SERVER refuses `referringOrganisationAudits` to a caller with no token at all. It does
 *    NOT prove that a signed-in staff user lacking both permissions is refused: that needs a
 *    second real token, and rests on the server's @PreAuthorize.
 *
 * Self-skips when the saved token is missing, fake or expired, or the membership-support flag is
 * off. Not tagged @mocked.
 *
 * Run: npx playwright test --config playwright.config.uat.ts org-allowance-and-history-live
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { getBearerToken, UatGraphQLClient, UAT_GRAPHQL_ENDPOINT } from '../helpers/graphql';
import { sampleName } from '../helpers/sample-data';

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

/** The display name the server writes into each audit revision (the token's `<namespace>/name` claim). */
function signedInName(): string {
  const claims = JSON.parse(Buffer.from(getBearerToken().split('.')[1], 'base64url').toString('utf8'));
  const key = Object.keys(claims).find(k => k.endsWith('/name'));
  return key ? String(claims[key]) : '';
}

async function flagOn(): Promise<boolean> {
  const ctx = await playwrightRequest.newContext();
  try {
    const res = await ctx.post(UAT_GRAPHQL_ENDPOINT, { data: { query: '{ featureFlagsPublic { key enabled } }' } });
    const body = await res.json();
    return !!body?.data?.featureFlagsPublic?.find((f: { key: string; enabled: boolean }) => f.key === 'membership-support')?.enabled;
  } finally {
    await ctx.dispose();
  }
}

const tokenProblem = uatTokenUnavailable();

interface Usage { cap: number | null; used: number; remaining: number | null; state: string; tier: string; expired: boolean }
interface OrgUsage { id: string; name: string; membership: Usage }

const BANDS = [
  { value: 'NEAR_LIMIT', label: 'Near limit (80% or more used)' },
  { value: 'LIMIT_REACHED', label: 'Limit reached' },
] as const;

/** Does the API's allowance fit the band? Mirrors MembershipUsageBand in the server schema. */
function inBand(band: string, m: Usage): boolean {
  if (m.cap == null) {
    return false; // uncapped (Tier 3) is in neither band
  }
  if (band === 'LIMIT_REACHED') {
    return m.state === 'LIMIT_REACHED' && (m.remaining ?? 0) <= 0;
  }
  return m.state !== 'LIMIT_REACHED' && (m.remaining ?? 0) > 0 && m.used * 100 >= m.cap * 80;
}

test.describe('organisation allowance filter and history (live UAT)', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;
  let membershipOn = false;

  test.beforeAll(async () => {
    // The UAT API can cold-start; warm it before driving the UI.
    test.setTimeout(150_000);
    uat = await UatGraphQLClient.create();
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await uat.request('query { referringOrganisationsConnection(page: { size: 1 }) { totalElements } }');
        break;
      } catch (err) {
        if (Date.now() > deadline) {
          throw err;
        }
        await new Promise(r => setTimeout(r, 3_000));
      }
    }
    membershipOn = await flagOn();
  });

  test.afterAll(async () => {
    await uat?.dispose();
  });

  test('Filter by Allowance shows only organisations in the chosen band', async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!membershipOn, 'membership-support flag is off in this environment');

    await page.goto('/dashboard/referring-organisations');
    await expect(page.getByTestId('membership-badge-key')).toBeVisible({ timeout: 60_000 });

    for (const band of BANDS) {
      // The API's own view of the band: the same filter the page sends (active organisations only).
      const api = await uat.request<{ referringOrganisationsConnection: { totalElements: number; content: OrgUsage[] } }>(
        `query ($filter: ReferringOrganisationWhereInput!) {
          referringOrganisationsConnection(page: { size: 500 }, where: $filter) {
            totalElements
            content { id name membership { tier cap used remaining state expired } }
          }
        }`,
        { filter: { archived: { _in: [false] }, membershipUsage: { _in: [band.value] } } },
      );
      const apiOrgs = api.referringOrganisationsConnection.content;
      const apiTotal = api.referringOrganisationsConnection.totalElements;
      // The server's band agrees with its own allowance numbers for every organisation it returns.
      for (const o of apiOrgs) {
        expect(inBand(band.value, o.membership), `API put #${o.id} in ${band.value}: ${JSON.stringify(o.membership)}`).toBe(true);
      }

      await page.locator('a.btn-info', { hasText: 'Filter' }).click();
      const modal = page.locator('.modal-content');
      await expect(modal.getByText('Filter by Allowance')).toBeVisible();
      for (const other of BANDS) {
        const box = modal.getByLabel(other.label);
        if (other.value === band.value) {
          await box.check();
        } else {
          await box.uncheck();
        }
      }
      const listResponse = page.waitForResponse(r =>
        r.url().includes('/graphql')
        && (r.request().postData() ?? '').includes('findAllReferringOrgs')
        && (r.request().postData() ?? '').includes(band.value), { timeout: 60_000 });
      await modal.getByRole('button', { name: 'Filter', exact: true }).click();
      const body = await (await listResponse).json();
      expect(body.errors, `the filtered list must load without error: ${JSON.stringify(body.errors)}`).toBeFalsy();
      const pageTotal: number = body.data.referringOrganisationsConnection.totalElements;
      expect(pageTotal, 'the table and the API must agree on how many organisations are in the band').toBe(apiTotal);

      const rows = page.locator('#referring-org-index tbody tr').filter({ has: page.getByTestId('membership-badges') });
      await expect(rows).toHaveCount(Math.min(10, apiTotal), { timeout: 30_000 });
      await expect(page.locator('.toast-warning, .toast-error')).toHaveCount(0);

      if (apiTotal === 0) {
        test.info().annotations.push({
          type: 'uat-data',
          description: `No active organisation in UAT is "${band.label}"; only checked that the filtered table loads without error.`,
        });
        continue;
      }

      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const id = (await row.locator('td').first().innerText()).trim();
        const usage = (await row.getByTestId('membership-usage').innerText()).trim();
        const m = /^(\d+) \/ (\d+)$/.exec(usage);
        expect(m, `row #${id} must show a capped usage "used / cap", got "${usage}"`).not.toBeNull();
        const used = +m![1];
        const cap = +m![2];
        if (band.value === 'LIMIT_REACHED') {
          await expect(row.getByTestId('badge-limit'), `row #${id} must carry the Limit reached badge`).toBeVisible();
          expect(used, `row #${id}: nothing left means used >= cap (${usage})`).toBeGreaterThanOrEqual(cap);
        } else {
          await expect(row.getByTestId('badge-limit'), `row #${id} is near, not at, its limit`).toHaveCount(0);
          expect(used, `row #${id}: something left (${usage})`).toBeLessThan(cap);
          expect(used * 100, `row #${id}: 80% or more used (${usage})`).toBeGreaterThanOrEqual(cap * 80);
        }
        // Cross-check the badge against the API's numbers for the same organisation.
        const fromApi = apiOrgs.find(o => String(o.id) === id);
        expect(fromApi, `row #${id} must be in the API's ${band.value} set`).toBeTruthy();
        expect(usage).toBe(`${fromApi!.membership.used} / ${fromApi!.membership.cap}`);
      }
    }
  });

  test('History shows a tier change made on the organisation page', async ({ page }) => {
    test.setTimeout(150_000);
    test.skip(!membershipOn, 'membership-support flag is off in this environment');
    const who = signedInName();
    expect(who, 'the saved token must carry a name claim for the audit trail').not.toBe('');

    const name = sampleName('Org');
    const { createReferringOrganisation: org } = await uat.request<{ createReferringOrganisation: { id: string } }>(
      `mutation ($data: CreateReferringOrganisationInput!) { createReferringOrganisation(data: $data) { id } }`,
      { data: { name, website: null, phoneNumber: null } },
    );
    uat.track('referringOrganisation', org.id);

    await page.goto(`/dashboard/referring-organisations/${org.id}`);
    const tier = page.getByTestId('org-membership-tier');
    await expect(tier).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('.breadcrumb-item.active')).toHaveText(name);

    // History first, so the save below also exercises the tab reloading after a save.
    await page.getByTestId('org-history-tab').click();
    const rows = page.getByTestId('org-history-row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const before = await rows.count();
    await expect(rows.last().getByTestId('org-history-changes')).toHaveText('Organisation created');

    await page.locator('a.nav-link', { hasText: 'Details' }).click();
    const tier1 = (await tier.locator('option').allInnerTexts()).find(t => t.trim().startsWith('Tier 1'));
    expect(tier1, 'the tier select must offer Tier 1').toBeTruthy();
    await tier.selectOption({ label: tier1!.trim() });
    await expect(page.getByTestId('org-membership-start')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

    const saved = page.waitForResponse(r =>
      r.url().includes('/graphql') && (r.request().postData() ?? '').includes('updateReferringOrganisation'), { timeout: 30_000 });
    await page.getByTestId('org-save').click();
    const json = await (await saved).json();
    expect(json.errors, `save must not error: ${JSON.stringify(json.errors)}`).toBeFalsy();
    expect(json.data.updateReferringOrganisation.membershipTier).toBe('TIER_1');

    await page.locator('a.nav-link', { hasText: 'History' }).click();
    await expect(rows).toHaveCount(before + 1, { timeout: 30_000 });
    const top = rows.first();
    await expect(top.getByTestId('org-history-changes').locator('div').first()).toHaveText('Tier: Free → Tier 1');
    await expect(top.locator('td').nth(1)).toHaveText(who);
    await expect(top).toHaveClass(/table-warning/);
    await expect(top.locator('td').nth(3)).toHaveText('Tier 1');

    // The server's own record of the same revision.
    const audits = await uat.request<{
      referringOrganisationAudits: { revision: { customUser: string }; entity: { membershipTier: string | null } }[];
    }>(
      'query ($id: Long!) { referringOrganisationAudits(where: $id) { revision { customUser } entity { membershipTier } } }',
      { id: org.id },
    );
    const last = audits.referringOrganisationAudits[audits.referringOrganisationAudits.length - 1];
    expect(last.entity.membershipTier).toBe('TIER_1');
    expect(last.revision.customUser.split('|')[1]).toBe(who);
  });

  test('the server refuses the audit trail to a caller with no token', async () => {
    // UI gate: proven by the @mocked spec (see header). A second real token would be needed to
    // prove a signed-in non-admin is refused; this checks only that the query is not open.
    const ctx = await playwrightRequest.newContext();
    try {
      const res = await ctx.post(UAT_GRAPHQL_ENDPOINT, {
        data: { query: 'query { referringOrganisationAudits(where: 1) { type revision { customUser } } }' },
      });
      expect(res.status(), 'an app-level refusal, not a Cloudflare 403').not.toBe(403);
      const body = await res.json().catch(() => ({}));
      expect(body?.data?.referringOrganisationAudits ?? null, 'no audit rows without a token').toBeNull();
      if (res.ok()) {
        expect(JSON.stringify(body.errors ?? []), 'the refusal must be an access error').toMatch(/denied|unauthori[sz]ed|forbidden/i);
      } else {
        expect(res.status()).toBe(401);
      }
    } finally {
      await ctx.dispose();
    }
  });
});
