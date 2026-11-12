/**
 * Formly's type registry is loaded on demand, not at bootstrap (perf: src/main.ts used to register
 * every custom type, which kept Formly core, ng-select, the ngb date/time pickers, date-fns and ~50 kB
 * of field components in the initial `main` bundle).
 *
 * The registration now happens in `formlyTypesGuard` (src/app/shared/modules/formly/formly-types.guard.ts),
 * attached once to the group of routes that render a <formly-form> in core-widgets.routes.ts. Two things
 * must hold, and this spec pins both:
 *
 *   1. A page that renders no Formly form must not download Formly or ng-select
 *      at all (this is the red-on-dev assertion: on dev they are in the eager bundle).
 *   2. Every form host still gets its types: a missing type throws "[Formly Error] The type "x" could
 *      not be found", which e2e/helpers/csp.ts turns into a failure for every spec that imports it,
 *      and this spec additionally opens the form UIs (filter modals are created by NgbModal, outside
 *      any route injector, so they prove the types live in the root FormlyConfig singleton) and
 *      reaches a form route by client-side navigation from a non-form route.
 *
 * @mocked: all GraphQL is stubbed (including the buildInfo health probe, see the testing skill).
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

// Strings that exist only in the library code, so a response body containing one means it was shipped
// to the browser. Formly core: its "type could not be found" error; ng-select: its dropdown panel
// selector. (ngb-bootstrap is one prebundled file under the dev server and the header already needs it, so it cannot be used as a marker here; the production build output shows it only in lazy chunks.)
const MARKERS = {
  'Formly core': 'registered through the FormlyModule',
  'ng-select': 'ng-dropdown-panel',
} as const;

const json = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });

/** Every operation answers with empty-but-valid data; the health probe and flags are answered explicitly. */
async function stubGraphql(page: Page) {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) {
      return json(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
    }
    if (body.includes('featureFlagsPublic')) return json(route, { featureFlagsPublic: [] });
    if (body.includes('deliveryAvailabilityPublic')) return json(route, { deliveryAvailabilityPublic: [] });
    // Any paged list: zero rows. Anything else: empty object.
    const data: Record<string, unknown> = {};
    for (const m of body.matchAll(/(?:(\w+)\s*:\s*)?(\w+Connection)\b/g)) {
      data[m[1] ?? m[2]] = { totalElements: 0, content: [] };
    }
    return json(route, data);
  });
}

/** Collects the body of every JavaScript response the page receives. */
function collectScripts(page: Page): { url: string; body: Promise<string> }[] {
  const scripts: { url: string; body: Promise<string> }[] = [];
  page.on('response', res => {
    if (res.request().resourceType() === 'script') {
      scripts.push({ url: res.url(), body: res.text().catch(() => '') });
    }
  });
  return scripts;
}

async function librariesLoaded(scripts: { url: string; body: Promise<string> }[]) {
  const bodies = await Promise.all(scripts.map(async s => ({ url: s.url, body: await s.body })));
  const loaded: Record<string, string[]> = {};
  for (const [label, marker] of Object.entries(MARKERS)) {
    loaded[label] = bodies.filter(b => b.body.includes(marker)).map(b => b.url.split('/').pop() ?? b.url);
  }
  return loaded;
}

test.describe('Formly types load on demand @mocked', () => {
  for (const route of ['/delivery-booking', '/404']) {
    test(`${route} (no form) downloads no Formly or ng-select code`, async ({ page }) => {
      test.setTimeout(90_000);
      await stubGraphql(page);
      const scripts = collectScripts(page);

      await page.goto(route);
      if (route === '/delivery-booking') {
        await expect(page.locator('app-booking-flow')).toBeVisible({ timeout: 30_000 });
      } else {
        await expect(page.locator('body')).toContainText(/404|not found/i, { timeout: 30_000 });
      }
      await page.waitForLoadState('networkidle');

      expect(scripts.length, 'the page loaded scripts at all (sanity)').toBeGreaterThan(0);
      expect(await librariesLoaded(scripts)).toEqual({ 'Formly core': [], 'ng-select': [] });
    });
  }

  test('a form route loads them (control: the markers above really identify the libraries)', async ({ page }) => {
    test.setTimeout(90_000);
    await stubGraphql(page);
    const scripts = collectScripts(page);

    await page.goto('/dashboard/donors');
    await expect(page.locator('#donor-index')).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    const loaded = await librariesLoaded(scripts);
    expect(loaded['Formly core'].length).toBeGreaterThan(0);
  });

  test('client-side navigation from a non-form route to a form route registers the types first', async ({ page }) => {
    test.setTimeout(90_000);
    await stubGraphql(page);
    const formlyErrors: string[] = [];
    page.on('console', m => /\[Formly Error\]/.test(m.text()) && formlyErrors.push(m.text()));

    // /dashboard/roles is in the non-form group: no types registered yet.
    await page.goto('/dashboard/roles');
    await expect(page.locator('a[routerLink="/dashboard/donors"], a[href="/dashboard/donors"]').first()).toBeAttached({ timeout: 30_000 });
    await page.locator('.sidebar a[href="/dashboard/donors"]').first().click();
    await expect(page.locator('#donor-index')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('link', { name: 'Filter' }).click();
    await expect(page.locator('.modal-body formly-form input[type="checkbox"]').first()).toBeVisible({ timeout: 15_000 });
    expect(formlyErrors).toEqual([]);
  });

  // Filter / create forms live in NgbModal windows. NgbModal creates their views from the ROOT
  // injector, so this is the case that breaks if the types are provided on a route injector only.
  const modalHosts: { route: string; open: string | RegExp; fieldInModal: string }[] = [
    { route: '/dashboard/donors', open: 'Filter', fieldInModal: 'input[type="checkbox"]' },
    { route: '/dashboard/donor-parents', open: 'Filter', fieldInModal: 'input' },
    { route: '/dashboard/devices', open: 'Filter', fieldInModal: 'ng-select' },
    { route: '/dashboard/device-requests', open: 'Filter', fieldInModal: 'ng-select' },
    { route: '/dashboard/referring-organisations', open: 'Filter', fieldInModal: 'input' },
    { route: '/dashboard/referring-organisation-contacts', open: 'Filter', fieldInModal: 'input' },
    { route: '/dashboard/distributions-and-deliveries', open: 'Filter', fieldInModal: 'ng-select' },
    { route: '/dashboard/posts', open: 'Create Post', fieldInModal: 'input' },
    { route: '/dashboard', open: 'Create Post', fieldInModal: 'input' },
  ];
  for (const h of modalHosts) {
    test(`${h.route}: the modal renders its Formly fields`, async ({ page }) => {
      test.setTimeout(90_000);
      await stubGraphql(page);
      const formlyErrors: string[] = [];
      page.on('console', m => /\[Formly Error\]/.test(m.text()) && formlyErrors.push(m.text()));
      page.on('pageerror', e => /\[Formly Error\]/.test(String(e)) && formlyErrors.push(String(e)));

      await page.goto(h.route);
      await page.getByRole('link', { name: h.open }).or(page.getByRole('button', { name: h.open })).first().click();
      await expect(page.locator(`.modal-body formly-form ${h.fieldInModal}`).first()).toBeVisible({ timeout: 15_000 });
      expect(formlyErrors).toEqual([]);
    });
  }
});
