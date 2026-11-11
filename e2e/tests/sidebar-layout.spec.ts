/**
 * Layout behaviours that used to live in src/sb-admin-2.min.js (jQuery) and the header's
 * `$('body').toggleClass(...)`; now `LayoutService` (#113, milestone 9). Pins every behaviour of
 * the old script that still mattered:
 *  - below 768px the sidebar starts collapsed (`body.sidebar-toggled`); at 768px and up it is shown,
 *  - crossing 768px by resizing collapses / expands it,
 *  - the phone header button toggles it,
 *  - scrolling on a phone collapses it again,
 *  - the scroll-to-top button appears after 100px of scroll and smooth-scrolls back to the top.
 *
 * @mocked — GraphQL is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const ROLES = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `Role ${i}`, description: `Desc ${i}` }));

async function installMocks(page: Page): Promise<void> {
  const ok = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  await page.route('**/graphql', async route => {
    const raw = route.request().postData() ?? '';
    if (raw.includes('buildInfo')) return ok(route, { buildInfo: { version: '1', commit: 'a', time: '2026-01-01T00:00:00Z' } });
    if (raw.includes('featureFlagsPublic')) return ok(route, { featureFlagsPublic: [] });
    if (raw.includes('findAllRoles')) return ok(route, { roles: { totalElements: 10, number: 0, content: ROLES } });
    return ok(route, {});
  });
}

const sidebar = (page: Page) => page.locator('app-sidebar ul.sidebar').first();
const toggled = (page: Page) => page.evaluate(() => document.body.classList.contains('sidebar-toggled'));

test.describe('sidebar and scroll-to-top @mocked', () => {
  test('desktop: sidebar shown, no scroll button until scrolled, button returns to top', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 400 });
    await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    expect(await toggled(page)).toBe(false);
    await expect(sidebar(page)).toBeVisible();
    const top = page.locator('a.scroll-to-top');
    await expect(top).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(top).toBeVisible();
    // Scrolling on a desktop never collapses the sidebar.
    expect(await toggled(page)).toBe(false);

    await top.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(top).toBeHidden();
    // The click is handled in place: no navigation to #page-top.
    expect(page.url()).not.toContain('#page-top');
  });

  test('phone: starts collapsed, header button toggles, scrolling collapses it again', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    expect(await toggled(page)).toBe(true);
    await expect(sidebar(page)).toBeHidden();

    await page.locator('#sidebarToggleTop').click();
    expect(await toggled(page)).toBe(false);
    await expect(sidebar(page)).toBeVisible();
    await page.locator('#sidebarToggleTop').click();
    expect(await toggled(page)).toBe(true);

    await page.locator('#sidebarToggleTop').click();
    await expect(sidebar(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(() => toggled(page)).toBe(true);
    await expect(sidebar(page)).toBeHidden();
  });

  test('resizing across 768px collapses and expands the sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 700 });
    await installMocks(page);
    await page.goto('/dashboard/roles');
    await expect(page.locator('#role-index tbody tr')).toHaveCount(10);
    expect(await toggled(page)).toBe(false);

    await page.setViewportSize({ width: 600, height: 700 });
    await expect.poll(() => toggled(page)).toBe(true);
    await expect(sidebar(page)).toBeHidden();

    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => toggled(page)).toBe(false);
    await expect(sidebar(page)).toBeVisible();
  });
});
