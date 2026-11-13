/**
 * src/sb-admin.css carries a copy of Bootstrap 4.4.1 that loads AFTER Bootstrap 5. It was deduped against
 * Bootstrap 5 (rules identical to v5's, and v4-only classes nothing uses, were removed).
 *
 * Two things are pinned here:
 *  1. the dedupe stays done: the stylesheet no longer contains a known duplicated v4 rule and stays under a
 *     rule-count ceiling (a re-vendored full Bootstrap 4 would blow it);
 *  2. three places where a v4 rule that LOOKS identical to Bootstrap 5's is load-bearing because of rule ORDER
 *     (sb-admin.css wins every equal-specificity tie). A naive dedupe removed them and changed the page:
 *       - `.d-none` + `.d-sm-block` on the top bar divider (display must be block from 576px),
 *       - `.border` + `.border-0` on the borough availability cell being edited (no border: the sb-admin
 *         `.border` is #e3e6f0 and sits earlier than `.border-0`),
 *       - `.btn` under prefers-reduced-motion (transition must be none).
 *
 * @mocked: every GraphQL operation is stubbed (including the { buildInfo } health probe, which otherwise leaves
 * the page behind the "Server is starting up" interstitial after 1 s); Auth0 is a synthetic cache entry.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { loginAsStaff } from '../helpers/auth0-cache';

const TS = '2026-01-01T00:00:00Z';
const DEVICE_KEYS = ['laptops', 'phones', 'tablets', 'allInOnes', 'desktops', 'commsDevices', 'broadbandHubs', 'other'];

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('BoroughAvailabilityAdmin')) {
      return fulfill(route, {
        boroughGroups: [{
          id: '2', name: 'Tower Hamlets', boroughs: ['Tower Hamlets'], status: 'PILOT', maxPerReferee: 1,
          availability: DEVICE_KEYS.map(deviceType => ({ deviceType, mode: 'ON' })), updatedAt: TS,
        }],
        referrerLimitExceptions: [],
        adminConfig: {
          id: '1', canPublicRequestLaptop: true, canPublicRequestPhone: true, canPublicRequestTablet: true,
          canPublicRequestDesktop: true, canPublicRequestSIMCard: true, canPublicRequestBroadbandHub: true, updatedAt: TS,
        },
      });
    }
    return fulfill(route, {});
  });
}

test.describe('sb-admin.css dedupe against Bootstrap 5 @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
    await loginAsStaff(page);
  });

  test('the stylesheet no longer carries the duplicated Bootstrap 4 rules', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/dashboard');
    await expect(page.locator('app-header')).toBeVisible({ timeout: 30_000 });
    const { total, duplicate } = await page.evaluate(() => {
      let total = 0; let duplicate = 0;
      const walk = (rules: CSSRuleList): void => {
        for (const r of Array.from(rules)) {
          if (r instanceof CSSStyleRule) {
            total++;
            // v5 defines `.pt-1` and `.py-1` separately; the v4 grouped rule only survives in the old sb-admin.css
            if (r.selectorText === '.pt-1, .py-1') duplicate++;
          } else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules);
        }
      };
      for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules); } catch { /* cross-origin sheet */ } }
      return { total, duplicate };
    });
    expect(duplicate, 'the v4 `.pt-1, .py-1` rule must not come back').toBe(0);
    expect(total, 'total CSS rule count (all global stylesheets) must stay under the post-dedupe ceiling').toBeLessThan(CEILING);
  });

  test('top bar divider is shown from 576px up (.d-none then .d-sm-block, order matters)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/dashboard');
    await expect(page.locator('.topbar-divider')).toBeVisible({ timeout: 30_000 });
    expect(await page.locator('.topbar-divider').evaluate(e => getComputedStyle(e).display)).toBe('block');
  });

  test('a .btn has no transition under prefers-reduced-motion', async ({ page }) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dashboard');
    await expect(page.locator('app-header')).toBeVisible({ timeout: 30_000 });
    const btn = page.locator('#sidebarToggleTop');
    expect(await btn.evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s');
  });

  test('the borough availability cell being edited keeps no border (.border-0 must beat sb-admin .border)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/dashboard/admin-panel');
    await page.getByRole('link', { name: 'Device Availability' }).click();
    const cell = page.locator('[data-testid="cell-2-phones"]');
    await expect(cell).toBeVisible({ timeout: 30_000 });
    await cell.click();
    await expect(page.locator('[data-testid="cell-editor"]')).toBeVisible();
    await expect(cell).toHaveClass(/\bborder\b/);
    expect(await cell.evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('0px');
  });
});

/** Rules in all global stylesheets as served by `ng serve`, measured after the dedupe, plus headroom. */
const CEILING = 4800;
