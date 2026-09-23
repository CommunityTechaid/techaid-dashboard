/**
 * Regression cover for @ng-select/ng-select's major bump (21.8.2 to 24.1.2, three majors,
 * landed in 92e7387 alongside the Angular 22 upgrade). ng-select backs every `type: 'choice'`
 * formly field (src/app/shared/modules/formly/components/choice.component.ts) — the widest
 * blast radius of any third-party component touched by that upgrade, used throughout the
 * filter modals and forms in src/app/views/corewidgets.
 *
 * This exercises kit-index's "Status of the device" filter field: a static-items, multi-select
 * ng-select with no typeahead, so it needs no GraphQL stub beyond the page shell and the
 * DataTables ajax query itself. Covers: the dropdown opens, options render from `items`, a
 * selection can be made, and the chosen value reaches the form model and is carried into the
 * reload query sent to the backend — proving the whole formControl binding survived the major.
 *
 * Repo pitfall confirmed while writing this spec: ng-select's dropdown panel renders in an
 * overlay OUTSIDE the host element and does not close itself after a pick, so it has to be
 * dismissed explicitly before touching anything it might otherwise overlay (here, the modal's
 * own Apply button) — BUT dismissing it with Escape (as first tried) silently reverted the
 * selection: the reload's `where` clause came back with no `status` at all, even though the
 * picked option's chip was still visibly rendered in the closed select. Clicking an unrelated
 * element (the modal title) to close the panel instead does not have this side effect and is
 * what this spec uses. This is itself evidence of a real v24 migration hazard: an Escape
 * keypress ends up on ng-select's internal state rather than just the panel.
 *
 * Sanity-checked by breaking what it guards: temporarily removing choice.component.ts's
 * `[formControl]="formControl"` binding (so ng-select's selection never reaches the reactive
 * form) turns the badge-count assertion red (1 instead of 2) — confirmed, then reverted.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { test, expect, Page, Route } from '@playwright/test';

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };

test.describe('ng-select choice field (kit-index status filter) @mocked', () => {
  test('dropdown opens, options render, a selection reaches the model and the reload query', async ({ page }) => {
    test.setTimeout(60_000);

    const kitQueries: string[] = [];
    await page.route('**/graphql', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findAllKits')) {
        kitQueries.push(body);
        return fulfillJson(route, {
          kitsConnection: {
            totalElements: 1,
            number: 0,
            content: [{
              id: 1, make: 'Dell', model: 'NGSELECT-KIT-MODEL', age: 1, type: 'LAPTOP', status: 'DONATION_NEW',
              location: 'Brixton store', updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
              lotId: null, donor: null, deviceRequest: null,
            }],
          },
        });
      }
      return fulfillJson(route, {});
    });

    await page.goto('/dashboard/devices');
    await expect(page.locator('#kit-index tbody tr', { hasText: 'NGSELECT-KIT-MODEL' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('link', { name: 'Filter' }).click();
    await expect(page.locator('.modal-title')).toHaveText('Device Filters', { timeout: 10_000 });

    // The label and its ng-select share a parent <div> (formly's bootstrap wrapper), with no
    // stable class of its own — so locate via the unique label text.
    const statusField = page.locator('label', { hasText: 'Status of the device' }).locator('xpath=..');
    const statusSelect = statusField.locator('ng-select');
    await expect(statusSelect).toBeVisible();

    // Opening the dropdown renders its options.
    await statusSelect.click();
    const panel = page.locator('.ng-dropdown-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('New device registered', { exact: true })).toBeVisible();

    // A selection can be made.
    await panel.getByText('New device registered', { exact: true }).click();
    await expect(statusSelect.getByText('New device registered', { exact: true })).toBeVisible();

    // Close the panel via an unrelated click rather than Escape — see header comment.
    await page.locator('.modal-title').click();
    await expect(panel).toBeHidden();

    const reload = page.waitForResponse(
      r => r.url().includes('/graphql') && (r.request().postData() ?? '').includes('findAllKits'),
      { timeout: 15_000 },
    );
    await page.locator('.modal-footer').getByRole('button', { name: 'Filter' }).click();
    await reload;

    // The chosen value reached the form model and was carried into the reload's query
    // variables — the badge (status + the default archived filter = 2) and the request body
    // are two independent signals of that.
    await expect(page.getByRole('link', { name: 'Filter' }).locator('.badge')).toHaveText('2', { timeout: 10_000 });
    expect(kitQueries.some(q => q.includes('DONATION_NEW'))).toBe(true);
  });
});
