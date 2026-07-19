/**
 * Mocked coverage for delivery-booking feature-flag gating (feature-flag.service.ts +
 * delivery-booking.component.ts).
 *
 * The visibility rule is: `visible = !isProduction || live`, `live = flag enabled`.
 * The uat-local test config has production=false, so the route is ALWAYS visible here —
 * which means the guard's production 404 path (deliveryBookingVisibleGuard) is NOT
 * exercisable under uat-local (see the note in the PR body). What IS exercisable is the
 * UAT preview banner, which keys purely off `live` (the flag) and so responds to the
 * mocked featureFlagsPublic value regardless of environment:
 *   - flag OFF  → live=false → banner shown.
 *   - flag ON   → live=true  → banner hidden.
 *
 * feature-flag.service.ts POSTs featureFlagsPublic via plain HttpClient to /graphql, so
 * page.route('**\/graphql') catches it.
 *
 * @mocked — no token, all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stubs /graphql with the delivery-booking flag at the given enabled state. */
async function installFlagMock(page: Page, deliveryBookingEnabled: boolean): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('featureFlagsPublic')) {
      return fulfillJson(route, {
        data: { featureFlagsPublic: [{ key: 'delivery-booking', enabled: deliveryBookingEnabled }] },
      });
    }
    if (body.includes('deliveryAvailabilityPublic')) {
      // Keep the booking flow from erroring; no day is needed for the banner assertion.
      return fulfillJson(route, { data: { deliveryAvailabilityPublic: [] } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

test.describe('delivery-booking flag gating @mocked', () => {
  test('shows the UAT preview banner when the flag reports not-live', async ({ page }) => {
    test.setTimeout(60_000);
    await installFlagMock(page, false);

    await page.goto('/delivery-booking');
    // The route is visible (production=false) but the flag is off → UAT banner.
    await expect(page.locator('.uat-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.uat-banner')).toContainText('UAT preview');
    // The booking flow itself is still rendered underneath the banner.
    await expect(page.locator('app-booking-flow')).toBeVisible();
  });

  test('hides the UAT preview banner when the flag is live', async ({ page }) => {
    test.setTimeout(60_000);
    await installFlagMock(page, true);

    await page.goto('/delivery-booking');
    // Booking flow renders; with the flag live the UAT banner must be absent.
    await expect(page.locator('app-booking-flow')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.uat-banner')).toHaveCount(0);
  });
});
