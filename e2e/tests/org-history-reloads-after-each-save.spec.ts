/**
 * The organisation page's History tab reloads after EVERY save in a page visit, not only the
 * first. The tab re-queries when its `version` input (the organisation's updatedAt) changes, so
 * the save mutation must hand back a fresh updatedAt each time.
 *
 * The mutation mock answers with exactly the fields the save mutation selects, as the server
 * would: a field the document does not ask for never comes back.
 *
 * @mocked — all GraphQL stubbed, no token needed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const MEMBERSHIP = {
  tier: 'TIER_2', periodStart: '2026-11-01', periodEnd: '2027-10-31', cap: 40, used: 3, remaining: 37,
  state: 'OK', graceUsed: 0, expired: false, lapsedTier: null, lapsedOn: null,
};

const BASE = {
  id: 5,
  name: 'HISTORY-ORG',
  website: 'https://example.org',
  phoneNumber: '07700900000',
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  membershipTier: 'TIER_2',
  membershipStartDate: '2026-11-01',
  membershipEndDate: '2027-10-31',
  membership: MEMBERSHIP,
  membershipContacts: [],
};

/** The top-level fields of the operation's selection set (enough for this flat document). */
function selectedFields(query: string, op: string): string[] {
  const body = query.slice(query.lastIndexOf(`${op}(`)); // the field, not the operation name
  const open = body.indexOf('{');
  const fields: string[] = [];
  let depth = 0;
  for (const token of body.slice(open + 1).match(/[{}]|[A-Za-z_]\w*/g) ?? []) {
    if (token === '{') depth++;
    else if (token === '}') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) fields.push(token);
  }
  return fields;
}

const pick = (obj: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter(k => k !== '__typename').map(k => [k, obj[k] ?? null]));

const revision = (id: number, phoneNumber: string) => ({
  type: id === 1 ? 'ADD' : 'MOD',
  revision: { id, timestamp: Date.parse('2026-11-02T10:00:00Z') + id * 60_000, customUser: 'cat@example.org|Cat Admin' },
  entity: {
    name: 'HISTORY-ORG', website: 'https://example.org', phoneNumber, archived: false,
    membershipTier: 'TIER_2', membershipStartDate: '2026-11-01', membershipEndDate: '2027-10-31',
  },
});

async function installMocks(page: Page) {
  let org = { ...BASE };
  const audits = [revision(1, BASE.phoneNumber)];
  const seen = { audits: 0, saves: 0 };
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (raw.includes('buildInfo')) {
      return json({ buildInfo: { version: 'e2e', commit: 'e2e', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('featureFlagsPublic')) {
      return json({ featureFlagsPublic: [{ key: 'membership-support', enabled: true }] });
    }
    if (raw.includes('getReferringOrganisationAuditTrail')) {
      seen.audits++;
      return json({ referringOrganisationAudits: audits });
    }
    if (raw.includes('mutation updateReferringOrganisation(')) {
      // What the server does: write a revision, bump updatedAt, answer with the selection only.
      seen.saves++;
      const { data } = JSON.parse(raw).variables;
      org = { ...org, phoneNumber: data.phoneNumber, updatedAt: new Date(Date.parse(org.updatedAt) + 60_000).toISOString() };
      audits.push(revision(audits.length + 1, org.phoneNumber));
      const { query } = JSON.parse(raw);
      return json({ updateReferringOrganisation: pick(org, selectedFields(query, 'updateReferringOrganisation')) });
    }
    if (raw.includes('findReferringOrganisation(')) {
      return json({ referringOrganisation: org });
    }
    if (raw.includes('findAllReferringOrgContacts')) {
      return json({ referringOrganisationContactsConnection: { totalElements: 0, content: [] } });
    }
    if (raw.includes('findAllDeviceRequests') || raw.includes('findAllOrgs')) {
      return json({ deviceRequestConnection: { totalElements: 0, content: [] } });
    }
    return json({});
  });
  return seen;
}

test.describe('organisation history reloads after each save @mocked', () => {
  test('a second save in the same visit also refreshes the History tab', async ({ page }) => {
    test.setTimeout(90_000);
    await loginWith(page, ['read:organisations', 'write:organisations', 'admin:organisations']);
    const seen = await installMocks(page);
    await page.goto('/dashboard/referring-organisations/5');

    const history = page.getByTestId('org-history-tab');
    const details = page.locator('a.nav-link', { hasText: 'Details' });
    const rows = page.getByTestId('org-history-row');
    const phone = page.getByLabel('Phone Number');

    await history.click({ timeout: 30_000 });
    await expect(rows).toHaveCount(1);

    for (const [i, number] of ['07700900001', '07700900002'].entries()) {
      await details.click();
      await phone.fill(number);
      await page.getByTestId('org-save').click();
      await expect.poll(() => seen.saves).toBe(i + 1);
      await expect(page.locator('.toast-info', { hasText: 'Successfully updated' }).last()).toBeVisible();

      await history.click();
      await expect(rows, `History must show the revision from save ${i + 1}`).toHaveCount(i + 2, { timeout: 10_000 });
      await expect(rows.first().getByTestId('org-history-changes')).toHaveText(
        `Phone: ${i === 0 ? '07700900000' : '07700900001'} → ${number}`);
    }
  });
});
