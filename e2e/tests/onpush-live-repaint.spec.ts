import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { UatGraphQLClient } from '../helpers/graphql';

/**
 * Live counterpart to onpush-fanout.spec.ts (@mocked). That spec proves the 12 OnPush
 * components' DataTables ajax callback repaints the table on the FIRST render (stubbed
 * data, page.goto, assert a row appears). It cannot prove the thing the OnPush migration
 * is actually risky for: a SECOND, user-driven ajax reload firing while the component is
 * already alive — e.g. typing into the DataTables search box — which is exactly the path
 * each ajax callback's own `cdr.markForCheck()` guards. A mock can't catch a missing
 * markForCheck any more reliably than a hand-wave, because a stubbed response landing in
 * the same synchronous tick as the request can accidentally repaint anyway. This spec
 * drives the real UAT backend so a genuine, independently-timed second server round trip
 * has to repaint the table for the assertions to pass.
 *
 * READ-ONLY: every route handler below aborts any request whose GraphQL body carries a
 * `mutation` operation, so this spec can never write to UAT. (The task's suggested probe
 * `/"query":"\s*mutation/` doesn't reliably match this codebase's own mutations: nearly
 * every `gql` tag here opens with a newline right after the backtick — e.g.
 * `gql\`\nmutation createKits(...)` — so the serialized JSON body reads
 * `"query":"\nmutation ..."`, where `\n` is the two literal characters backslash+n, not
 * whitespace `\s` can match. We parse the JSON and check `query.trim()` instead, which
 * catches every mutation regardless of leading-newline formatting — the same intent, made
 * to actually fire.)
 *
 * All 9 index tables AND all 3 child tables covered here share the identical DataTables
 * 2.x `searching: true` + `dom` layout (verified against every component's own
 * `dtOptions`), so none of them need the "no search box → change page instead" fallback
 * the task anticipates for tables that might lack one.
 *
 * "Distinctive text" is taken from a specific anchor in the row — not simply "the first
 * anchor" or "the longest text" — because which column is searchable varies per table:
 * kit-index/device-request-index/distributions-and-deliveries-index search by id (numeric
 * autodetect or `_contains`), so the id-badge (anchor 0) works; but
 * referring-organisation-index/referring-organisation-contact-index/referee-component
 * search by name/fullName only (id is NOT one of their OR-clause fields) even though their
 * id-badge is ALSO anchor 0 and non-empty — so those three explicitly use anchor 1 (the
 * name/fullName link). Each anchorIndex below was verified against that table's own
 * `QUERY_ENTITY` OR-clause and its own template's column order, not guessed.
 *
 * The distinctive-text term for phase (c) is captured AFTER the clear-search round trip
 * (phase b), not before phase a — some tables (referring-organisation-contact-index sorts
 * `updatedAt desc` by default) put whatever record another CONCURRENT spec file just
 * touched at the very top of the unfiltered list. Capturing early and re-searching several
 * live round trips later raced that record being archived out from under us mid-test by an
 * unrelated worker; capturing right before the search that consumes it shrinks that window
 * to a single round trip.
 *
 * REAL APP BUG FOUND while writing this spec: kit-component.component.ts's QUERY_ENTITY
 * (~line 36) ANDs `model` and `location` together instead of OR-ing them, and omits `id`/
 * `serialNo` entirely (unlike kit-index's own, correctly OR-based, search) — see the
 * comment at its call site below. Its search box is effectively non-functional for any
 * single real-world term; phase (c) is skipped there rather than asserting a search that
 * cannot pass by design. Not fixed here — this spec's task is coverage, not that repair.
 */

function getBearerToken(): string {
  const statePath = resolve(process.cwd(), 'e2e/.auth/user.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) {
        const parsed = JSON.parse(item.value);
        return parsed?.body?.access_token ?? '';
      }
    }
  }
  throw new Error('No Auth0 token found in e2e/.auth/user.json');
}

/** True when a raw GraphQL POST body's `query` field is a mutation. */
function isMutationBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.query === 'string' && parsed.query.trim().startsWith('mutation');
  } catch {
    return false;
  }
}

/** Same interceptor pattern as bugs.spec.ts's withAuthInterceptor, plus the read-only guard. */
async function withReadOnlyAuthInterceptor(page: Page): Promise<void> {
  const token = getBearerToken();
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (isMutationBody(body)) {
      await route.abort();
      return;
    }
    if (body.includes('buildInfo')) {
      await route.continue().catch(() => {});
      return;
    }
    const headers = { ...route.request().headers(), Authorization: `Bearer ${token}` };
    await route.continue({ headers }).catch(() => {});
  });
}

/** Seeds the two known persisted index filters to `{}` so neither hides the baseline set. */
async function seedEmptyFilters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('kitFilters-') || key.startsWith('deviceRequestFilters-'))) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem('kitFilters-kit-index', JSON.stringify({}));
    localStorage.setItem('deviceRequestFilters-device-request-index', JSON.stringify({}));
  });
}

function waitForAnyGraphqlResponse(page: Page, timeout = 20_000) {
  return page.waitForResponse(r => r.url().includes('/graphql') && r.status() === 200, { timeout }).catch(() => null);
}

/** Real data rows only — excludes DataTables' own native empty/zeroRecords placeholder row,
 * which the app's `data: []` ajax-callback contract leaves behind in the DOM alongside the
 * Angular-rendered row set (see bugs.spec.ts BUG-07 for the full story on that quirk). */
function dataLinks(page: Page, tableId: string): Locator {
  return page.locator(`#${tableId} tbody tr td a[href^="/dashboard/"]`);
}

async function distinctiveText(page: Page, tableId: string, anchorIndex: number): Promise<string> {
  const row = page.locator(`#${tableId} tbody tr`, { has: page.locator('td a[href^="/dashboard/"]') }).first();
  const text = await row.locator('a[href^="/dashboard/"]').nth(anchorIndex).textContent();
  return (text ?? '').trim();
}

async function searchAndReload(page: Page, tableId: string, term: string): Promise<void> {
  const input = page.locator(`input[aria-controls="${tableId}"]`);
  const reload = waitForAnyGraphqlResponse(page);
  await input.fill(term);
  await input.press('Enter');
  await reload;
}

/**
 * The shared repaint check: nonsense search empties the table, clearing restores it, and
 * (unless `skipTermSearch`) re-searching a term captured fresh right after the clear
 * surfaces a row containing it again. Each phase is a SEPARATE live ajax round trip, so a
 * missing `cdr.markForCheck()` in the ajax callback would leave the table showing stale
 * rows from the PREVIOUS phase instead of the new response's — which is exactly what these
 * assertions would catch.
 */
async function assertSearchRepaint(
  page: Page,
  tableId: string,
  anchorIndex: number,
  nonsenseTerm: string,
  skipTermSearch = false,
): Promise<void> {
  await expect.poll(() => dataLinks(page, tableId).count(), { timeout: 20_000 }).toBeGreaterThan(0);

  const infoLocator = page.locator(`#${tableId}_wrapper .dt-info`);
  const unfilteredInfo = (await infoLocator.textContent().catch(() => null))?.trim() ?? null;

  // (a) nonsense search -> zero data rows (DataTables' own empty placeholder is all that's left)
  await searchAndReload(page, tableId, nonsenseTerm);
  await expect(dataLinks(page, tableId)).toHaveCount(0);

  // (b) clear -> rows return
  await searchAndReload(page, tableId, '');
  await expect.poll(() => dataLinks(page, tableId).count(), { timeout: 20_000 }).toBeGreaterThan(0);

  if (skipTermSearch) return;

  // Captured HERE, not before phase (a) — see the header comment on why: this shrinks the
  // window in which a concurrent spec file can archive/mutate the very record we picked.
  const term = await distinctiveText(page, tableId, anchorIndex);

  // (c) search the just-captured term -> a row containing it reappears
  if (term.length) {
    await searchAndReload(page, tableId, term);
    await expect.poll(() => dataLinks(page, tableId).count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(dataLinks(page, tableId).filter({ hasText: term }).first()).toBeVisible();

    // The info label ("Showing X to Y of Z entries...") should differ from the unfiltered
    // baseline whenever the unfiltered set had more than the one matching row to begin with.
    if (unfilteredInfo) {
      const totalMatch = unfilteredInfo.match(/of ([\d,]+) entr/i);
      const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : 0;
      if (total > 1) {
        const filteredInfo = (await infoLocator.textContent().catch(() => null))?.trim() ?? null;
        expect(filteredInfo).not.toBe(unfilteredInfo);
      }
    }
  }
}

interface IndexTableConfig {
  name: string;
  route: string;
  tableId: string;
  /** Anchor index (within the row's own `a[href^="/dashboard/"]` links) whose text is
   * guaranteed to be one of that table's own searchable fields — see header comment. */
  anchorIndex: number;
}

const INDEX_TABLES: IndexTableConfig[] = [
  { name: 'kit-index', route: '/dashboard/devices', tableId: 'kit-index', anchorIndex: 0 },
  { name: 'device-request-index', route: '/dashboard/device-requests', tableId: 'device-request-index', anchorIndex: 0 },
  { name: 'referring-organisation-index', route: '/dashboard/referring-organisations', tableId: 'referring-org-index', anchorIndex: 1 },
  { name: 'referring-organisation-contact-index', route: '/dashboard/referring-organisation-contacts', tableId: 'referring-org-contact-index', anchorIndex: 1 },
  { name: 'donor-parent-index', route: '/dashboard/donor-parents', tableId: 'donor-parent-index', anchorIndex: 1 },
  { name: 'post-index', route: '/dashboard/posts', tableId: 'post-index', anchorIndex: 1 },
  { name: 'user-index', route: '/dashboard/users', tableId: 'user-index', anchorIndex: 1 },
  { name: 'role-index', route: '/dashboard/roles', tableId: 'role-index', anchorIndex: 0 },
  { name: 'distributions-and-deliveries-index', route: '/dashboard/distributions-and-deliveries', tableId: 'distributions-and-deliveries-index', anchorIndex: 0 },
];

test.describe('OnPush live repaint — index tables (live UAT, read-only)', () => {
  test.beforeEach(async ({ page }) => {
    await seedEmptyFilters(page);
    await withReadOnlyAuthInterceptor(page);
  });

  for (const cfg of INDEX_TABLES) {
    test(`${cfg.name}: a live ajax reload actually repaints the table`, async ({ page }) => {
      test.setTimeout(60_000);
      const initialLoad = waitForAnyGraphqlResponse(page);
      await page.goto(cfg.route);
      await expect(page.locator(`#${cfg.tableId}`)).toBeVisible({ timeout: 15_000 });
      await initialLoad;

      await assertSearchRepaint(page, cfg.tableId, cfg.anchorIndex, `zzqx-no-match-${Date.now()}`);
    });
  }
});

test.describe('OnPush live repaint — child tables embedded in detail pages (live UAT, read-only)', () => {
  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    uat = await UatGraphQLClient.create();
  });

  test.beforeEach(async ({ page }) => {
    await withReadOnlyAuthInterceptor(page);
  });

  test('kit-component (Devices tab on a device-request detail page): repaints on live reload', async ({ page }) => {
    test.setTimeout(60_000);
    const res = await uat.request<{ deviceRequestConnection: { content: { id: string; kits: { id: string }[] }[] } }>(
      `query { deviceRequestConnection(page: { size: 300, sort: [{ key: "id", value: "desc" }] }, where: {}) { content { id kits { id } } } }`,
    );
    const withKits = res.deviceRequestConnection.content.find(d => d.kits && d.kits.length > 0);
    if (!withKits) {
      test.skip(true, 'No device request with assigned kits found in the 300 most recent UAT records — skipping (needs UAT data with kit assignments)');
      return;
    }

    await page.goto(`/dashboard/device-requests/${withKits.id}`);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });
    const devicesTab = page.locator('ul.nav-tabs .nav-link', { hasText: /\d+ Device.*Assigned/i });
    await expect(devicesTab).toBeVisible({ timeout: 15_000 });

    const tableId = `device-request-index-${withKits.id}`;
    const kitsResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllKits') && r.status() === 200,
      { timeout: 15_000 },
    ).catch(() => null);
    await devicesTab.click();
    await kitsResp;

    await expect(page.locator(`#${tableId}`)).toBeVisible({ timeout: 10_000 });
    // skipTermSearch: real app bug (see header comment) — kit-component's own QUERY_ENTITY
    // ANDs `model` and `location` together and never references `id`/`serialNo`, unlike
    // kit-index's correctly OR-based search, so no single real-world term can ever match.
    // Phases (a)/(b) still prove the live repaint; phase (c) would only prove a bug exists,
    // which isn't this spec's job.
    await assertSearchRepaint(page, tableId, 0, `zzqx-no-match-${Date.now()}`, true);
  });

  test('donor-component (Individual Donors tab on a donor-parent detail page): repaints on live reload', async ({ page }) => {
    test.setTimeout(60_000);
    const res = await uat.request<{ donorParentsConnection: { content: { id: string; donorCount: number }[] } }>(
      `query { donorParentsConnection(page: { size: 300 }, where: {}) { content { id donorCount } } }`,
    );
    const withDonors = res.donorParentsConnection.content.find(d => d.donorCount > 0);
    if (!withDonors) {
      test.skip(true, 'No donor-parent with individual donors found in the first 300 UAT records — skipping (needs UAT data with donors attached)');
      return;
    }

    await page.goto(`/dashboard/donor-parents/${withDonors.id}`);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });
    const donorsResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllDonors') && r.status() === 200,
      { timeout: 15_000 },
    ).catch(() => null);
    // ngbNav renders tabs with role="tab" (an ARIA tablist) — see onpush-fanout.spec.ts.
    await page.getByRole('tab', { name: 'Individual Donors' }).click();
    await donorsResp;

    // donor-component.html hard-codes id="donor-index" on this table (not the tableId
    // @Input) — a pre-existing quirk of the component, documented in onpush-fanout.spec.ts.
    await expect(page.locator('#donor-index')).toBeVisible({ timeout: 10_000 });
    await assertSearchRepaint(page, 'donor-index', 1, `zzqx-no-match-${Date.now()}`);
  });

  test('referee-component (Referees tab on a referring-organisation detail page): repaints on live reload', async ({ page }) => {
    test.setTimeout(60_000);
    // Must be a non-archived contact — referee-component's own list defaults to
    // `archived: false`, so a discovery query without that constraint can pick an org whose
    // only contact is archived and render a genuinely (correctly) empty child table.
    const res = await uat.request<{ referringOrganisationContactsConnection: { content: { id: string; referringOrganisation: { id: string } | null }[] } }>(
      `query { referringOrganisationContactsConnection(page: { size: 1 }, where: { archived: { _eq: false } }) { content { id referringOrganisation { id } } } }`,
    );
    const contact = res.referringOrganisationContactsConnection.content[0];
    if (!contact?.referringOrganisation?.id) {
      test.skip(true, 'No active referring-organisation-contact found in UAT — skipping (needs at least one non-archived referee on record)');
      return;
    }
    const orgId = contact.referringOrganisation.id;

    await page.goto(`/dashboard/referring-organisations/${orgId}`);
    await expect(page.locator('ul.nav-tabs')).toBeVisible({ timeout: 15_000 });
    const tableId = `referring-organisation-referees-${orgId}`;
    const refereesResp = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllReferringOrgContacts') && r.status() === 200,
      { timeout: 15_000 },
    ).catch(() => null);
    await page.getByRole('tab', { name: 'Referees' }).click();
    await refereesResp;

    await expect(page.locator(`#${tableId}`)).toBeVisible({ timeout: 10_000 });
    await assertSearchRepaint(page, tableId, 1, `zzqx-no-match-${Date.now()}`);
  });
});
