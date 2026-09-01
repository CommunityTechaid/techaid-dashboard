/**
 * Mocked coverage for the public delivery-booking flow (booking-flow.component +
 * reference-step.component + details-step.component + booking-api.service). These pin
 * the delivery-booking hardening shipped recently:
 *
 *   1. REFERENCE GATE — the flow now opens on a reference step. Submitting it runs
 *      deliveryBookingEligibilityPublic; eligible:true advances to the day step (and only
 *      then loads availability), eligible:false keeps the visitor on the reference step
 *      and shows the server's message verbatim, and a transport-level failure on that
 *      query still lets the visitor through (the server re-checks identically at submit).
 *   2. TURNSTILE GATE — with a siteKey configured (the uat-local environment sets
 *      turnstile_site_key to Cloudflare's test key 1x00000000000000000000AA), the
 *      submit is blocked with a "verify your browser" note until the widget issues a
 *      token, and once issued the token is carried into the submitDeliveryBookingPublic
 *      mutation input.
 *   3. SINGLE-USE-TOKEN RESET (highest regression risk) — when a submit fails so
 *      submitError transitions null→non-null, details-step.component.ts ngOnChanges must
 *      call turnstile.reset(widgetId). Turnstile tokens are single-use; without this
 *      every retry after a duplicate/validation error would fail with a stale token.
 *   4. BookingApiError CONTRACT — a GraphQL error with extensions.classification
 *      "BAD_REQUEST" is shown verbatim (rejection copy); any other classification
 *      collapses to a generic message so raw internal errors never leak.
 *
 * The public flow does NOT use Apollo — booking-api.service.ts POSTs plain GraphQL via
 * HttpClient to the environment graphql_endpoint (/graphql), so page.route('**\/graphql')
 * still catches it. Turnstile is stubbed by pre-defining window.turnstile via
 * addInitScript BEFORE navigation, so no request to challenges.cloudflare.com ever fires:
 * turnstile.service.ts load() resolves immediately when window.turnstile already exists.
 *
 * The address field now has assistive Google Places autocomplete
 * (place-autocomplete.directive.ts), which fires debounced GETs to
 * cta-places-proxy.community-techaid.workers.dev as soon as the field is typed into.
 * reachDetailsStepAndFill installs a route stub for that host so this mocked suite never
 * leaves the machine; dedicated coverage for the autocomplete behaviour itself lives in
 * delivery-booking-address-autocomplete.spec.ts.
 *
 * ANONYMOUS BY CONTRACT. This describe overrides storageState to an empty context. Without
 * that override the chromium project's `storageState: 'e2e/.auth/user.json'` applies and these
 * tests run as a logged-in staff member — which is not who uses this page, and would hide an
 * anonymous-visitor regression. The dedicated test at the end of this file pins the property
 * the page depends on: nothing here may contact the Auth0 tenant. See the 2026-07-28 incident
 * (#159) for what happens on a public page that reaches Apollo's auth link without a session.
 *
 * @mocked — no token, all GraphQL stubbed.
 */
import { test, expect, Page } from '@playwright/test';
import { stubPlacesProxy } from '../helpers/places-proxy';

/** The exact rejection copy the server returns as a BAD_REQUEST, `<ref>` interpolated in. */
const rejectionMessage = (ref: string): string =>
  `You are not able to book a delivery for request ID '${ref}' at this time. Please check the number is correct, and try again if not. Otherwise please contact distributions@communitytechaid.org.uk quoting your request ID for further information`;

/** One bookable day with one window that has spots — enough to reach the details step. */
const AVAILABILITY = [
  {
    date: '2026-08-03',
    dayOfWeek: 'MONDAY',
    dayLabel: 'Monday 3 August',
    windows: [
      {
        spotsRemaining: 5,
        window: { id: 'win-morning', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm' },
      },
    ],
  },
];

const CONFIRMATION = {
  id: 'booking-1',
  date: '2026-08-03',
  dayLabel: 'Monday 3 August',
  window: { id: 'win-morning', name: 'Morning window', startTime: '10:00am', endTime: '1:00pm' },
  address: '1 Test Street, London SW9 0AA',
  ctaReference: 4298,
  confirmationSentTo: 'sofia@example.org',
};

interface SubmitOutcome {
  /** 'success' returns the confirmation; otherwise a GraphQL error is returned. */
  kind: 'success' | 'error';
  message?: string;
  classification?: string;
}

interface EligibilityOutcome {
  /** 'success' returns {eligible, message}; 'network-error' aborts the request. */
  kind: 'success' | 'network-error';
  eligible?: boolean;
  message?: string | null;
}

const ELIGIBLE: EligibilityOutcome = { kind: 'success', eligible: true, message: null };

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
 * Routes /graphql: eligibility → the given outcome (default eligible), availability →
 * AVAILABILITY (each call recorded into `availabilityRequests`), submit → the given
 * outcome (captured into `submits`), buildInfo/featureFlags/anything else → empty.
 * Outcomes are read from mutable holders so a single installer can serve different
 * results per test.
 */
async function installBookingMocks(
  page: Page,
  outcome: { current: SubmitOutcome },
  submits: unknown[],
  eligibility: { current: EligibilityOutcome } = { current: ELIGIBLE },
  availabilityRequests: unknown[] = [],
): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('deliveryBookingEligibilityPublic')) {
      if (eligibility.current.kind === 'network-error') {
        return route.abort('failed');
      }
      return fulfillJson(route, {
        data: {
          deliveryBookingEligibilityPublic: {
            eligible: eligibility.current.eligible ?? true,
            message: eligibility.current.message ?? null,
          },
        },
      });
    }
    if (body.includes('deliveryAvailabilityPublic')) {
      availabilityRequests.push(body);
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

/** Fills the reference step's input and submits it. */
async function submitReferenceStep(page: Page, reference = '4298'): Promise<void> {
  await page.locator('input[formControlName="ctaReference"]').fill(reference);
  await page.locator('button[type="submit"]').click();
}

/** Walks reference → day → window → details and fills the required fields (no submit). */
async function reachDetailsStepAndFill(page: Page): Promise<void> {
  // The address field fires autocomplete requests to the Places proxy as soon as it's
  // typed into (see file header) — stub it so this @mocked suite stays hermetic.
  await stubPlacesProxy(page);
  await page.goto('/delivery-booking');
  await submitReferenceStep(page);
  await page.locator('.day-row').first().click();
  await page.locator('.window-row').first().click();

  const form = page.locator('form.form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.locator('input[formControlName="firstName"]').fill('Sofia');
  await form.locator('input[formControlName="surname"]').fill('Martino');
  await form.locator('input[formControlName="email"]').fill('sofia@example.org');
  await form.locator('input[formControlName="phone"]').fill('07700900000');
  await form.locator('input[formControlName="addressLine1"]').fill('1 Test Street');
  await form.locator('input[formControlName="addressLine2"]').fill('London SW9 0AA');
  await form.locator('input[formControlName="postcode"]').fill('SW9 7AA');
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
  // A genuine member of the public: no Auth0 cache, no cookies. See the file header.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('an ineligible reference keeps the user on the reference step and shows the server message', async ({ page }) => {
    test.setTimeout(60_000);
    const message = rejectionMessage('4298');
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    const eligibility = { current: { kind: 'success', eligible: false, message } as EligibilityOutcome };
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits, eligibility);

    await page.goto('/delivery-booking');
    await submitReferenceStep(page);

    await expect(page.locator('.status--error')).toHaveText(message, { timeout: 10_000 });
    // Still on the reference step — never advanced to the day step.
    await expect(page.locator('input[formControlName="ctaReference"]')).toBeVisible();
    await expect(page.locator('.day-row')).toHaveCount(0);
  });

  test('an eligible reference advances to the day step', async ({ page }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await page.goto('/delivery-booking');
    await submitReferenceStep(page);

    await expect(page.locator('.day-row').first()).toBeVisible({ timeout: 10_000 });
  });

  test('does not request availability until the reference is accepted', async ({ page }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    const availabilityRequests: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits, undefined, availabilityRequests);

    await page.goto('/delivery-booking');
    await expect(page.locator('input[formControlName="ctaReference"]')).toBeVisible();
    expect(availabilityRequests, 'availability must not be requested before the reference is accepted').toHaveLength(0);

    await submitReferenceStep(page);

    await expect(page.locator('.day-row').first()).toBeVisible({ timeout: 10_000 });
    expect(availabilityRequests.length, 'availability is requested once the reference is accepted').toBeGreaterThan(0);
  });

  test('an eligibility check that fails at the transport level still lets the user reach the day step', async ({ page }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    const eligibility = { current: { kind: 'network-error' } as EligibilityOutcome };
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits, eligibility);

    await page.goto('/delivery-booking');
    await submitReferenceStep(page);

    await expect(page.locator('.day-row').first()).toBeVisible({ timeout: 10_000 });
  });

  test('the details step shows the "who this is for" note, an un-named slot summary, and the right optional hints', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);

    await expect(page.locator('.intro--who')).toContainText(
      'All details should be for the individual we are delivering to on the day',
    );

    // The slot summary shows the window's times but not its internal `name` — see
    // details-step.component.ts's summarySlot getter.
    const summarySlot = page.locator('div.summary__slot');
    await expect(summarySlot).not.toContainText(AVAILABILITY[0].windows[0].window.name);
    await expect(summarySlot).toContainText(AVAILABILITY[0].windows[0].window.startTime);
    await expect(summarySlot).toContainText(AVAILABILITY[0].windows[0].window.endTime);

    // "Flat, building or office name" lost its "(optional)" hint; "Access notes" kept it.
    await expect(page.locator('label', { hasText: 'Flat, building or office name' })).not.toContainText('(optional)');
    await expect(page.locator('label', { hasText: 'Access notes' })).toContainText('(optional)');
  });

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
    const message = rejectionMessage('4298');
    const outcome = { current: { kind: 'error', message, classification: 'BAD_REQUEST' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);
    expect(await resetCount(page), 'no reset before any submit').toBe(0);

    await issueToken(page, 'fake-token-1');
    await page.locator('button[type="submit"]').click();

    // BAD_REQUEST → verbatim server copy in the banner.
    await expect(page.locator('.form-error--banner')).toHaveText(message, { timeout: 10_000 });
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

  test('completes a booking without ever contacting Auth0', async ({ page }) => {
    test.setTimeout(60_000);
    // booking-api.service.ts POSTs GraphQL via plain HttpClient specifically so this page
    // never touches the shared Apollo client, whose auth link calls getAccessTokenSilently()
    // and — for a visitor with no session — redirects to the Auth0 login. That was the
    // 2026-07-28 production incident on /organisation-device-request. The property is
    // currently structural, but nothing pinned it: a future refactor onto Apollo would take
    // this page down for the public with the whole suite still green.
    //
    // Any request reaching the tenant fails this test, so it also catches a redirect that
    // happens to land somewhere other than /authorize.
    let auth0Hits = 0;
    await page.route('**://techaid-auth.eu.auth0.com/**', route => {
      auth0Hits++;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>stub auth0 login</body></html>',
      });
    });

    const outcome = { current: { kind: 'success' } as SubmitOutcome };
    const submits: unknown[] = [];
    await stubTurnstile(page);
    await installBookingMocks(page, outcome, submits);

    await reachDetailsStepAndFill(page);
    await issueToken(page, 'fake-token-anon');
    await page.locator('button[type="submit"]').click();

    // The booking must actually go through — otherwise "never contacted Auth0" would pass
    // trivially on a page that failed to load at all.
    await expect(page.getByText('Your delivery is booked ✓')).toBeVisible({ timeout: 10_000 });
    expect(submits).toHaveLength(1);

    await expect(page).toHaveURL(/delivery-booking/);
    expect(auth0Hits, 'the public booking page must never contact the Auth0 tenant').toBe(0);
  });
});
