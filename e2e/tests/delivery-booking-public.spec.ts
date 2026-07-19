/**
 * Mocked coverage for the public delivery-booking flow (booking-flow.component +
 * details-step.component + booking-api.service). These pin the delivery-booking
 * hardening shipped recently:
 *
 *   1. TURNSTILE GATE — with a siteKey configured (the uat-local environment sets
 *      turnstile_site_key to Cloudflare's test key 1x00000000000000000000AA), the
 *      submit is blocked with a "verify your browser" note until the widget issues a
 *      token, and once issued the token is carried into the submitDeliveryBookingPublic
 *      mutation input.
 *   2. SINGLE-USE-TOKEN RESET (highest regression risk) — when a submit fails so
 *      submitError transitions null→non-null, details-step.component.ts ngOnChanges must
 *      call turnstile.reset(widgetId). Turnstile tokens are single-use; without this
 *      every retry after a duplicate/validation error would fail with a stale token.
 *   3. BookingApiError CONTRACT — a GraphQL error with extensions.classification
 *      "BAD_REQUEST" is shown verbatim (duplicate-booking copy); any other
 *      classification collapses to a generic message so raw internal errors never leak.
 *
 * The public flow does NOT use Apollo — booking-api.service.ts POSTs plain GraphQL via
 * HttpClient to the environment graphql_endpoint (/graphql), so page.route('**\/graphql')
 * still catches it. Turnstile is stubbed by pre-defining window.turnstile via
 * addInitScript BEFORE navigation, so no request to challenges.cloudflare.com ever fires:
 * turnstile.service.ts load() resolves immediately when window.turnstile already exists.
 *
 * @mocked — no token, all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';

/** The exact duplicate-booking copy the server returns as a BAD_REQUEST. */
const DUPLICATE_MESSAGE =
  'You already have an upcoming delivery booked. If you need to change it, please call us on 020 3488 2912.';

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
  address: '1 Test Street, London SW9 0AA',
  ctaReference: '4298',
  confirmationSentTo: 'sofia@example.org',
};

interface SubmitOutcome {
  /** 'success' returns the confirmation; otherwise a GraphQL error is returned. */
  kind: 'success' | 'error';
  message?: string;
  classification?: string;
}

async function fulfillJson(route: import('@playwright/test').Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Installs the fake Turnstile API before any app code runs. render() records the
 * widget id and stashes the options so the test can invoke opts.callback(token) on
 * demand; reset() records every call. Exposed on window for the spec to read/drive.
 */
async function stubTurnstile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { rendered: string[]; resets: string[] } = { rendered: [], resets: [] };
    (window as unknown as { __turnstile: typeof calls }).__turnstile = calls;
    let lastOpts: { callback?: (t: string) => void } | null = null;
    (window as unknown as { __issueTurnstileToken: (t: string) => void }).__issueTurnstileToken = (t: string) =>
      lastOpts?.callback?.(t);
    (window as { turnstile?: unknown }).turnstile = {
      render(_container: unknown, opts: { callback?: (t: string) => void }) {
        lastOpts = opts;
        const id = `fake-widget-${calls.rendered.length + 1}`;
        calls.rendered.push(id);
        return id;
      },
      reset(id?: string) {
        calls.resets.push(id ?? '(none)');
      },
      remove() {
        /* no-op */
      },
    };
  });
}

/**
 * Routes /graphql: availability → AVAILABILITY, submit → the given outcome (captured
 * into `submits`), buildInfo/featureFlags/anything else → empty. The outcome is read
 * from a mutable holder so a single installer can serve success or error per test.
 */
async function installBookingMocks(
  page: Page,
  outcome: { current: SubmitOutcome },
  submits: unknown[],
): Promise<void> {
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
      if (outcome.current.kind === 'success') {
        return fulfillJson(route, { data: { submitDeliveryBookingPublic: CONFIRMATION } });
      }
      return fulfillJson(route, {
        errors: [
          {
            message: outcome.current.message ?? 'error',
            extensions: { classification: outcome.current.classification },
          },
        ],
      });
    }
    if (body.includes('buildInfo')) {
      return fulfillJson(route, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } } });
    }
    return fulfillJson(route, { data: {} });
  });
}

/** Walks day → window → details and fills the required fields (no submit). */
async function reachDetailsStepAndFill(page: Page): Promise<void> {
  await page.goto('/delivery-booking');
  await page.locator('.day-row').first().click();
  await page.locator('.window-row').first().click();

  const form = page.locator('form.form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.locator('input[formControlName="firstName"]').fill('Sofia');
  await form.locator('input[formControlName="surname"]').fill('Martino');
  await form.locator('input[formControlName="email"]').fill('sofia@example.org');
  await form.locator('input[formControlName="phone"]').fill('07700900000');
  await form.locator('textarea[formControlName="address"]').fill('1 Test Street, London SW9 0AA');
  await form.locator('input[formControlName="ctaReference"]').fill('4298');
  // The widget host must have rendered (siteKey is set in uat-local).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __turnstile: { rendered: string[] } }).__turnstile.rendered.length))
    .toBeGreaterThan(0);
}

function issueToken(page: Page, token: string): Promise<void> {
  return page.evaluate((t) => (window as unknown as { __issueTurnstileToken: (x: string) => void }).__issueTurnstileToken(t), token);
}

const resetCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __turnstile: { resets: string[] } }).__turnstile.resets.length);

test.describe('public delivery-booking flow @mocked', () => {
  test('blocks submit until Turnstile issues a token', async ({ page }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);

    // No token issued yet: submitting must surface the "verify your browser" note
    // and must NOT fire the mutation.
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('.turnstile .form-error')).toHaveText(
      'Please wait a moment while we verify your browser.',
      { timeout: 5_000 },
    );
    expect(submits, 'no booking must be submitted before Turnstile verifies').toHaveLength(0);
  });

  test('submits with the Turnstile token once issued', async ({ page }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: any[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);
    await issueToken(page, 'fake-token-abc');
    await page.locator('button[type="submit"]').click();

    // Confirmation step renders and the mutation carried the issued token.
    await expect(page.locator('.step-label--done')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Your delivery is booked ✓')).toBeVisible();
    expect(submits).toHaveLength(1);
    expect(submits[0].variables.input.turnstileToken).toBe('fake-token-abc');
  });

  test('resets the Turnstile widget and shows the verbatim message on a BAD_REQUEST', async ({ page }) => {
    test.setTimeout(60_000);
    // The single-use-token regression: after a failed submit the widget must be reset
    // (details-step ngOnChanges) so the next attempt uses a fresh token.
    const outcome = { current: { kind: 'error', message: DUPLICATE_MESSAGE, classification: 'BAD_REQUEST' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);
    expect(await resetCount(page), 'no reset before any submit').toBe(0);

    await issueToken(page, 'fake-token-1');
    await page.locator('button[type="submit"]').click();

    // BAD_REQUEST → verbatim server copy in the banner.
    await expect(page.locator('.form-error--banner')).toHaveText(DUPLICATE_MESSAGE, { timeout: 10_000 });
    // …and the single-use token was reset for the next attempt.
    await expect.poll(() => resetCount(page), { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('shows a generic message (not the raw error) for a non-BAD_REQUEST classification', async ({ page }) => {
    test.setTimeout(60_000);
    const rawInternal = 'NullPointerException at DeliveryBookingService.kt:212';
    const outcome = { current: { kind: 'error', message: rawInternal, classification: 'INTERNAL_ERROR' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);
    await issueToken(page, 'fake-token-2');
    await page.locator('button[type="submit"]').click();

    const banner = page.locator('.form-error--banner');
    await expect(banner).toHaveText('Something went wrong booking your delivery. Please try again.', { timeout: 10_000 });
    await expect(banner, 'the raw internal error must never be shown to the public').not.toContainText('NullPointerException');
  });
});
