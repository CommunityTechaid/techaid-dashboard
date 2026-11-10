/**
 * Issue #76 - the Devices filter window's RESET button.
 *
 * RESET used to call Formly's `resetModel()` (which reverts to the model as it was when the window
 * opened) plus `filterForm.reset()` (which nulls every control), and never re-applied the filter.
 * So nothing visibly changed and the list kept its old filter; a later RESET "reverted" to
 * whatever was last applied. Expected: RESET clears every filter back to the page default
 * (Active devices only), re-applies it, rewrites the saved filters and the badge count.
 *
 * @mocked - every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginWith } from '../helpers/auth0-cache';

const FILTER_KEY = 'kitFilters-kit-index';

async function fulfill(route: import('@playwright/test').Route, data: any) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function stubGraphql(page: Page, findAllKits: any[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    let vars: any = {};
    try { vars = JSON.parse(raw).variables ?? {}; } catch { /* non-JSON */ }
    if (raw.includes('buildInfo')) {
      return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (raw.includes('findAllKits')) {
      findAllKits.push(vars);
      return fulfill(route, {
        kitsConnection: {
          totalElements: 1, number: 0,
          content: [{ id: 1, make: 'Dell', model: 'Latitude', age: 2, type: 'LAPTOP', status: 'DONATION_NEW',
            location: 'Brixton', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
            lotId: null, donor: null, deviceRequest: null }],
        },
      });
    }
    if (raw.includes('findAutocomplete')) {
      return fulfill(route, { deviceRequestConnection: { content: [] }, donorsConnection: { content: [] },
        donorParentsConnection: { content: [] }, kitsConnection: { content: [] } });
    }
    if (raw.includes('findUsers')) return fulfill(route, { deviceRequests: [], donorParents: [] });
    return fulfill(route, {});
  });
}

const lastWhere = (calls: any[]) => calls[calls.length - 1]?.where ?? {};

test.describe('kit-index filter RESET (#76) @mocked', () => {
  test('RESET clears all filters, re-applies, clears the badge and saved filters', async ({ page }) => {
    test.setTimeout(90_000);
    const calls: any[] = [];
    await loginWith(page, ['read:kits', 'write:kits'], {
      subject: 'auth0|e2e-issue-76',
      localStorage: { [FILTER_KEY]: JSON.stringify({ type: ['LAPTOP'], archived: [true] }) },
    });
    await stubGraphql(page, calls);

    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr').first()).toBeVisible({ timeout: 30_000 });

    // Saved filters are live: Laptop + Archived, badge shows 2.
    await expect.poll(() => lastWhere(calls).type, { timeout: 10_000 }).toEqual({ _in: ['LAPTOP'] });
    const badge = page.locator('a', { hasText: 'Filter' }).locator('.badge');
    await expect(badge).toHaveText('2');

    await page.locator('a', { hasText: 'Filter' }).first().click();
    const modal = page.locator('ngb-modal-window');
    await expect(modal.getByLabel('Archived Devices')).toBeChecked();

    const before = calls.length;
    await modal.getByRole('button', { name: 'RESET' }).click();

    // The form shows the page default: Active only, nothing else ticked.
    await expect(modal.getByLabel('Archived Devices')).not.toBeChecked();
    await expect(modal.getByLabel('Active Devices')).toBeChecked();

    // The list was re-queried without the old filter, without pressing Filter.
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBeGreaterThan(before);
    await expect.poll(() => lastWhere(calls).type, { timeout: 10_000, message: 'type filter must be gone' }).toBeUndefined();
    await expect.poll(() => lastWhere(calls).archived, { timeout: 10_000 }).toEqual({ _in: [false] });

    // Saved filters were rewritten to the default.
    const saved = await page.evaluate(k => localStorage.getItem(k), FILTER_KEY);
    expect(JSON.parse(saved!)).toEqual({ archived: [false] });

    // Badge counts only the default Active filter now.
    await expect(badge).toHaveText('1');

    // A second RESET after changing something goes to the default, not the last value.
    await modal.getByLabel('Archived Devices').check();
    await modal.getByRole('button', { name: 'RESET' }).click();
    await expect(modal.getByLabel('Archived Devices')).not.toBeChecked();
    await expect(modal.getByLabel('Active Devices')).toBeChecked();
  });
});
