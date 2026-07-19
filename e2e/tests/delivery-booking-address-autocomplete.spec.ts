/**
 * Mocked coverage for the assistive Google Places autocomplete on the public
 * delivery-booking address field (place-autocomplete.directive.ts, wired onto the
 * `address` textarea in details-step.component.html).
 *
 * Design under test: autocomplete is a pure suggestion aid. It must never gate
 * submission — free text is always valid, a suggestion is never required, and a
 * failing/erroring proxy must degrade silently to "no suggestions" rather than
 * breaking the field or the page. These specs pin exactly that contract:
 *
 *   1. Typing >=3 chars fires a debounced request to the (stubbed) proxy; the
 *      returned predictions render as suggestions; clicking one fills the address
 *      control with the suggestion's `description` and closes the list.
 *   2. Free text that is never assisted by a suggestion still flows unchanged into
 *      the submitDeliveryBookingPublic mutation input — proves Places never gates or
 *      rewrites what actually gets booked.
 *   3. A failing proxy (500) yields no suggestions and no thrown error; the field
 *      remains fully usable (the directive's catchError swallows the failure).
 *
 * Turnstile/GraphQL mocking mirrors delivery-booking-public.spec.ts's conventions
 * (stubTurnstile via addInitScript, page.route('**\/graphql') for the public
 * HttpClient-based BookingApiService). The Places proxy itself is stubbed via the
 * shared stubPlacesProxy helper — see e2e/helpers/places-proxy.ts for why that stub is
 * required for every spec that types into this field.
 *
 * @mocked — no token, all GraphQL and Places-proxy traffic stubbed.
 */
import { test, expect, Page } from '@playwright/test';
import { stubPlacesProxy, PlacesProxyOutcome } from '../helpers/places-proxy';

/** One bookable day with one window that has spots — enough to reach the details step. */
const AVAILABILITY = [
  {
    date: '2026-08-03',
    dayOfWeek: 'MONDAY',
    dayLabel: 'Monday 3 August',
    windows: [
      {
        spotsRemaining: 5,
        window: { id: 'win-morning', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm', icon: '☀️' },
      },
    ],
  },
];

const CONFIRMATION = {
  id: 'booking-1',
  date: '2026-08-03',
  dayLabel: 'Monday 3 August',
  window: { id: 'win-morning', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm', icon: '☀️' },
  address: '221B Typed Street, London SW1A 1AA',
  ctaReference: '4298',
  confirmationSentTo: 'sofia@example.org',
};

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Same fake Turnstile shim as delivery-booking-public.spec.ts. */
async function stubTurnstile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let lastOpts: { callback?: (t: string) => void } | null = null;
    (window as unknown as { __issueTurnstileToken: (t: string) => void }).__issueTurnstileToken = (t: string) =>
      lastOpts?.callback?.(t);
    (window as { turnstile?: unknown }).turnstile = {
      render(_container: unknown, opts: { callback?: (t: string) => void }) {
        lastOpts = opts;
        return 'fake-widget-1';
      },
      reset() {
        /* no-op */
      },
      remove() {
        /* no-op */
      },
    };
  });
}

/** Routes /graphql: availability → AVAILABILITY, submit → success (captured into `submits`). */
async function installBookingMocks(page: Page, submits: unknown[]): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliveryAvailabilityPublic')) {
      return fulfillJson(route, { data: { deliveryAvailabilityPublic: AVAILABILITY } });
    }
    if (body.includes('submitDeliveryBookingPublic')) {
      try {
        submits.push(JSON.parse(body));
      } catch {
        submits.push(body);
      }
      return fulfillJson(route, { data: { submitDeliveryBookingPublic: CONFIRMATION } });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

/** Walks day → window → details, leaving the form otherwise unfilled. */
async function reachDetailsStep(page: Page): Promise<void> {
  await page.goto('/delivery-booking');
  await page.locator('.day-row').first().click();
  await page.locator('.window-row').first().click();
  await expect(page.locator('form.form')).toBeVisible({ timeout: 15_000 });
}

function issueToken(page: Page, token: string): Promise<void> {
  return page.evaluate((t) => (window as unknown as { __issueTurnstileToken: (x: string) => void }).__issueTurnstileToken(t), token);
}

test.describe('public delivery-booking address autocomplete @mocked', () => {
  test('renders stubbed suggestions and fills the address control on click', async ({ page }) => {
    test.setTimeout(60_000);
    const submits: unknown[] = [];
    const placesOutcome: { current: PlacesProxyOutcome } = {
      current: {
        predictions: [
          { description: '10 Downing Street, London SW1A 2AA', place_id: 'p1' },
          { description: '10 Downing Court, Leeds LS1 1AA', place_id: 'p2' },
        ],
      },
    };
    await stubTurnstile(page);
    await stubPlacesProxy(page, placesOutcome);
    await installBookingMocks(page, submits);
    await reachDetailsStep(page);

    const address = page.locator('textarea[formControlName="address"]');
    await address.fill('10 Downing'); // >=3 chars → fires the debounced request

    const suggestions = page.locator('.address-suggestions li');
    await expect(suggestions).toHaveCount(2, { timeout: 5_000 });
    await expect(suggestions.first()).toHaveText('10 Downing Street, London SW1A 2AA');

    await suggestions.first().click();

    await expect(address).toHaveValue('10 Downing Street, London SW1A 2AA');
    await expect(page.locator('.address-suggestions')).toHaveCount(0);
  });

  test('free text with no suggestion selected reaches the mutation unchanged', async ({ page }) => {
    test.setTimeout(60_000);
    const submits: any[] = [];
    // No predictions ever returned — the visitor types an address Places doesn't know
    // about (e.g. a new build) and must still be able to book.
    await stubTurnstile(page);
    await stubPlacesProxy(page);
    await installBookingMocks(page, submits);
    await reachDetailsStep(page);

    const form = page.locator('form.form');
    await form.locator('input[formControlName="firstName"]').fill('Sofia');
    await form.locator('input[formControlName="surname"]').fill('Martino');
    await form.locator('input[formControlName="email"]').fill('sofia@example.org');
    await form.locator('input[formControlName="phone"]').fill('07700900000');
    await form.locator('textarea[formControlName="address"]').fill('221B Typed Street, London SW1A 1AA');
    await form.locator('input[formControlName="ctaReference"]').fill('4298');

    await expect(page.locator('.address-suggestions')).toHaveCount(0);

    await issueToken(page, 'fake-token-free-text');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.step-label--done')).toBeVisible({ timeout: 10_000 });
    expect(submits).toHaveLength(1);
    expect(submits[0].variables.input.address).toBe('221B Typed Street, London SW1A 1AA');
  });

  test('a failing proxy yields no suggestions and leaves the field usable', async ({ page }) => {
    test.setTimeout(60_000);
    const submits: unknown[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await stubTurnstile(page);
    await stubPlacesProxy(page, { current: { status: 500 } });
    await installBookingMocks(page, submits);
    await reachDetailsStep(page);

    const address = page.locator('textarea[formControlName="address"]');
    await address.fill('Somewhere that errors out');

    // Give the debounce (300ms) + request time to settle, then assert no suggestions
    // and no uncaught page error — the directive's catchError must swallow this.
    await page.waitForTimeout(800);
    await expect(page.locator('.address-suggestions')).toHaveCount(0);
    expect(consoleErrors).toHaveLength(0);

    // The field itself remains fully usable free-text input.
    await expect(address).toHaveValue('Somewhere that errors out');
  });
});
