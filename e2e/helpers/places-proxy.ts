/**
 * Route stub for the Google-Places-proxy Cloudflare Worker
 * (cta-places-proxy.community-techaid.workers.dev), used by
 * place-autocomplete.directive.ts on the public delivery-booking address field.
 *
 * The `@mocked` suite must never touch the real network. Without this stub, any spec
 * that types into the booking form's address field would fire a real debounced GET to
 * the deployed worker. The directive swallows request errors (free-typing must always
 * work), so a missed stub wouldn't fail loudly — it would just quietly leak a request
 * off the test machine. Call `stubPlacesProxy(page)` before navigating to the booking
 * flow in every spec that drives the address field.
 */
import { Page, Route } from '@playwright/test';

/** Matches the proxy regardless of path (`/autocomplete`) or query string. */
export const PLACES_PROXY_PATTERN = '**cta-places-proxy.community-techaid.workers.dev/**';

export interface PlacesProxyOutcome {
  /** HTTP status to return. >=400 simulates a proxy/upstream failure. */
  status?: number;
  predictions?: { description: string; place_id?: string }[];
}

/**
 * Installs the route stub. Pass a mutable `outcome` holder (`{ current: {...} }`) to
 * change the response between actions within a single test — mirrors the
 * `installBookingMocks` outcome-holder pattern in delivery-booking-public.spec.ts.
 * Defaults to a 200 with no predictions.
 */
export async function stubPlacesProxy(
  page: Page,
  outcome: { current: PlacesProxyOutcome } = { current: {} },
): Promise<void> {
  await page.route(PLACES_PROXY_PATTERN, async (route: Route) => {
    const { status = 200, predictions = [] } = outcome.current;
    if (status >= 400) {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'stubbed proxy failure' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ predictions }),
    });
  });
}
