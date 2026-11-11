/**
 * kit-index ID-list search: separators.
 *
 * Staff paste a column copied from a spreadsheet (one id per line, or tab/space separated), not
 * only "12, 34, 56". parseIdList used to require a comma, so those pastes fell back to a free-text
 * search that matched nothing useful. Whitespace of any kind now separates ids.
 *
 * A single-line <input> never holds a raw newline: the browser either rewrites pasted newlines to
 * spaces or drops them, so the spec drives the real paste path (a ClipboardEvent on the box) as
 * well as typing, and also checks that a lone number and a multi-word search stay free-text.
 *
 * @mocked, every GraphQL operation is page.route-stubbed.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const IDS = [1001, 1002, 1003];

const kitRow = (id: number) => ({
  id, make: 'Dell', model: `Latitude ${id}`, age: 2, type: 'LAPTOP', status: 'ALLOCATION_READY',
  location: 'Brixton store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  lotId: null, donor: null, deviceRequest: null,
});

function idsFromWhere(where: any): number[] {
  if (!where) return [];
  if (where.id && Array.isArray(where.id._in)) return where.id._in.map(Number);
  if (Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      const found = idsFromWhere(clause);
      if (found.length) return found;
    }
  }
  return [];
}

async function stub(page: Page, seen: any[]) {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    const vars = JSON.parse(raw || '{}').variables ?? {};
    const reply = (data: any) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (raw.includes('buildInfo')) {
      return reply({ buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('findKitsByIdList')) {
      return reply({ kitsConnection: { totalElements: IDS.length, content: IDS.map(id => ({ id, status: 'ALLOCATION_READY' })) } });
    }
    if (raw.includes('findAllKits')) {
      seen.push(vars);
      const wanted = idsFromWhere(vars.where);
      const rows = wanted.length ? IDS.filter(i => wanted.includes(i)) : [900, 901];
      return reply({ kitsConnection: { totalElements: rows.length, number: 0, content: rows.map(kitRow) } });
    }
    if (raw.includes('findAutocomplete')) {
      return reply({ deviceRequestConnection: { content: [] }, donorsConnection: { content: [] },
        donorParentsConnection: { content: [] }, kitsConnection: { content: [] } });
    }
    return reply({});
  });
}

const BOX = '#kit-index_wrapper .dt-search input';

test.describe('kit-index ID list separators @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await loginWith(page, ['read:kits'], {
      subject: 'auth0|e2e-id-separators',
      localStorage: { 'kitFilters-kit-index': JSON.stringify({ archived: [false] }) },
    });
  });

  async function open(page: Page, seen: any[]) {
    await stub(page, seen);
    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr').first()).toBeVisible({ timeout: 30_000 });
  }

  const idListCalls = (seen: any[]) => seen.filter(v => idsFromWhere(v.where).length);

  for (const [name, text] of [
    ['space separated', '1001 1002 1003'],
    ['tab separated', '1001\t1002\t1003'],
    ['mixed, repeated and trailing separators', ' 1001 ,\t 1002  1003 , '],
  ] as const) {
    test(`typed value, ${name}, is read as an ID list`, async ({ page }) => {
      const seen: any[] = [];
      await open(page, seen);
      await page.locator(BOX).fill(text);
      await expect.poll(() => idListCalls(seen).length, { timeout: 15_000 }).toBeGreaterThan(0);
      const vars = idListCalls(seen).pop();
      expect(idsFromWhere(vars.where)).toEqual(IDS);
      expect(vars.term).toBe('');
      await expect(page.locator('[data-testid="id-list-banner"]')).toBeVisible({ timeout: 15_000 });
    });
  }

  test('a newline-separated paste (spreadsheet column) is read as an ID list', async ({ page }) => {
    const seen: any[] = [];
    await open(page, seen);
    // Real paste path: put raw newlines on the system clipboard and press Ctrl+V, so the browser's
    // own single-line-input handling decides what the box ends up holding.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText(['1001', '1002', '1003', ''].join('\n')));
    await page.locator(BOX).click();
    await page.keyboard.press('Control+V');
    const value = await page.locator(BOX).inputValue();
    // Chromium rewrites each pasted newline to a space; a browser that dropped them would give 100110021003.
    expect(value).toMatch(/^1001\s+1002\s+1003\s*$/);
    await page.locator(BOX).press('Enter');
    await expect.poll(() => idListCalls(seen).length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(idsFromWhere(idListCalls(seen).pop().where)).toEqual(IDS);
  });

  test('a lone number and a multi-word search stay ordinary text searches', async ({ page }) => {
    const seen: any[] = [];
    await open(page, seen);
    for (const term of ['1001', 'dell latitude']) {
      seen.length = 0;
      await page.locator(BOX).fill(term);
      await page.locator(BOX).press('Enter');
      await expect.poll(() => seen.some(v => v.term === term), { timeout: 15_000 }).toBe(true);
      expect(seen.every(v => idsFromWhere(v.where).length === 0)).toBe(true);
    }
    await expect(page.locator('[data-testid="id-list-banner"]')).toHaveCount(0);
  });
});
