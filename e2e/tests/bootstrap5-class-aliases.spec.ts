/**
 * Bootstrap 4 -> 5 class-name migration, stage 1: templates use Bootstrap 5 class names while src/sb-admin.css
 * (Bootstrap 4.4.1 + SB Admin 2, loaded AFTER bootstrap.css so it wins every equal-specificity tie) is still loaded.
 * src/bs5-aliases.css (loaded last) gives the new names the old sb-admin look. This spec pins that look so the
 * later stages (a theme layer, then deleting the v4 region of sb-admin.css) cannot silently change it.
 *
 *  1. The alias look: each renamed class is rendered on probe elements injected into a real app page (so every
 *     global stylesheet applies, in production order) and its computed style is compared with the sb-admin v4 value.
 *  2. Three places where a v4 rule that LOOKS identical to Bootstrap 5's is load-bearing because of rule ORDER
 *     (carried over from the closed dedupe attempt, PR #386):
 *       - `.d-none` + `.d-sm-block` on the top bar divider (display must be block from 576px),
 *       - `.border` + `.border-0` on the borough availability cell being edited (no border),
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

/** Rendered with the sb-admin v4 `.badge-*` rule before the rename: [class, color, background-color]. */
const BADGES: [string, string, string][] = [
  ['text-bg-primary', 'rgb(255, 255, 255)', 'rgb(0, 37, 144)'], // --ctablue #002590
  ['text-bg-secondary', 'rgb(255, 255, 255)', 'rgb(133, 135, 150)'],
  ['text-bg-success', 'rgb(255, 255, 255)', 'rgb(28, 200, 138)'],
  ['text-bg-info', 'rgb(255, 255, 255)', 'rgb(54, 185, 204)'],
  ['text-bg-warning', 'rgb(255, 255, 255)', 'rgb(246, 194, 62)'],
  ['text-bg-danger', 'rgb(255, 255, 255)', 'rgb(231, 74, 59)'],
  ['text-bg-light', 'rgb(58, 59, 69)', 'rgb(248, 249, 252)'],
];

const PROBE = `
  <div id="bs5-probe">
    ${BADGES.map(([cls]) => `<span class="badge ${cls}" data-probe="${cls}">12</span>`).join('')}
    <a href="#" class="badge text-bg-light" data-probe="link-badge">501</a>
    <div class="row g-0" data-probe="g0-row"><div class="col me-2" data-probe="g0-col">a</div><div class="col-auto" data-probe="g0-col-auto">b</div></div>
    <div class="row" data-probe="plain-row"><div class="col" data-probe="plain-col">a</div></div>
    <div class="mb-3" data-probe="mb-3">field</div>
    <span class="fw-bold" data-probe="fw-bold">bold</span>
    <span class="fst-italic" data-probe="fst-italic">italic</span>
    <div class="text-end" data-probe="text-end">right</div>
    <div class="text-start" data-probe="text-start">left</div>
    <span class="me-1 pe-1 ps-1" data-probe="spacing">x</span>
  </div>`;

async function injectProbe(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.locator('app-header')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(html => document.body.insertAdjacentHTML('afterbegin', html), PROBE);
}

function css(page: Page, probe: string, prop: string): Promise<string> {
  return page.locator(`[data-probe="${probe}"]`).evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
}

test.describe('Bootstrap 5 class names keep the sb-admin look @mocked', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
    await loginAsStaff(page);
  });

  test('text-bg-* badges use the SB badge palette and the v4 badge box', async ({ page }) => {
    test.setTimeout(60_000);
    await injectProbe(page);
    for (const [cls, color, bg] of BADGES) {
      expect(await css(page, cls, 'color'), `${cls} color`).toBe(color);
      expect(await css(page, cls, 'background-color'), `${cls} background`).toBe(bg);
    }
    // the box still comes from sb-admin's v4 .badge: padding .25em .4em (BS5 would be .35em .65em), radius .35rem
    const box = await page.locator('[data-probe="text-bg-secondary"]').evaluate(e => {
      const s = getComputedStyle(e); const em = parseFloat(s.fontSize);
      return { top: parseFloat(s.paddingTop) / em, left: parseFloat(s.paddingLeft) / em, radius: s.borderTopLeftRadius };
    });
    expect(box.top).toBeCloseTo(0.25, 2);
    expect(box.left).toBeCloseTo(0.4, 2);
    expect(box.radius).toBe('5.6px');
  });

  test('a link badge (kit-ID links) keeps the v4 hover shade', async ({ page }) => {
    test.setTimeout(60_000);
    await injectProbe(page);
    await page.locator('[data-probe="link-badge"]').hover();
    // sb-admin's .badge has a 0.15s colour transition: poll until it settles instead of reading mid-fade
    await expect.poll(() => css(page, 'link-badge', 'background-color')).toBe('rgb(212, 218, 237)'); // #d4daed
    expect(await css(page, 'link-badge', 'color')).toBe('rgb(58, 59, 69)');
    expect(await css(page, 'link-badge', 'text-decoration-line')).toBe('none');
  });

  test('g-0 removes the row margins and column paddings, like v4 no-gutters', async ({ page }) => {
    test.setTimeout(60_000);
    await injectProbe(page);
    expect(await css(page, 'g0-row', 'margin-left')).toBe('0px');
    expect(await css(page, 'g0-row', 'margin-right')).toBe('0px');
    for (const probe of ['g0-col', 'g0-col-auto']) {
      expect(await css(page, probe, 'padding-left'), probe).toBe('0px');
      expect(await css(page, probe, 'padding-right'), probe).toBe('0px');
    }
    expect(await css(page, 'g0-col', 'margin-right')).toBe('8px'); // me-2 still applies
    // a plain row keeps the 1.5rem SB gutter
    expect(await css(page, 'plain-row', 'margin-left')).toBe('-12px');
    expect(await css(page, 'plain-col', 'padding-left')).toBe('12px');
  });

  test('the utility renames compute the same values as their v4 names', async ({ page }) => {
    test.setTimeout(60_000);
    await injectProbe(page);
    expect(await css(page, 'mb-3', 'margin-bottom')).toBe('16px'); // was .form-group
    expect(await css(page, 'fw-bold', 'font-weight')).toBe('700');
    expect(await css(page, 'fst-italic', 'font-style')).toBe('italic');
    expect(await css(page, 'text-end', 'text-align')).toBe('right');
    expect(await css(page, 'text-start', 'text-align')).toBe('left');
    expect(await css(page, 'spacing', 'margin-right')).toBe('4px');
    expect(await css(page, 'spacing', 'padding-right')).toBe('4px');
    expect(await css(page, 'spacing', 'padding-left')).toBe('4px');
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
