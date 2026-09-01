/**
 * Live-UAT end-to-end smoke test for the public delivery-booking flow.
 *
 * Unlike delivery-booking-public.spec.ts (@mocked — stubbed GraphQL, stubbed
 * Turnstile, runs against ng-serve), this spec drives the REAL flow against the
 * DEPLOYED UAT origin: real availability data, the real Cloudflare Turnstile widget
 * (UAT's siteKey `1x00000000000000000000AA` is Cloudflare's "always passes" test key,
 * so the managed widget auto-completes with no interaction needed), and a real
 * `submitDeliveryBookingPublic` mutation that writes a row to the UAT database and
 * sends a real confirmation email to the smoke address below. It exists to catch the
 * class of bug the mocked spec structurally cannot: anything that only breaks against
 * the real server (CSP headers stripping the widget, a schema drift between FE and
 * deployed BE, real-availability edge cases, the real Turnstile round-trip).
 *
 * @live-smoke — EXCLUDED BY DEFAULT. It creates a real booking on a real deployed
 * origin and must never run as a side effect of `npx playwright test`, `npm run
 * e2e:fast`, or CI. playwright.config.ts / playwright.config.uat.ts both inspect argv
 * and install a `grepInvert: /@live-smoke/` UNLESS the invocation already explicitly
 * asked for @live-smoke via --grep (see the comment above `grepInvert` in each config
 * for why a static config-level grepInvert can't coexist with an explicit CLI --grep
 * — they AND together rather than one overriding the other).
 *
 * Run it explicitly (needs a fresh token — see e2e/save-token.mjs):
 *
 *   npx playwright test --config playwright.config.uat.ts live-booking-smoke --grep @live-smoke
 *
 * playwright.config.uat.ts is the right config here (not the default): it targets the
 * deployed origin directly with no local webServer/ng-serve, and already has a
 * deployed-origin storageState (e2e/.auth/uat-deployed.json) wired up. The default
 * config also works (baseURL is overridden below) but wastes time booting a local
 * ng serve this spec never uses.
 *
 * CLEANUP: the booking this spec creates is deleted via the admin `deleteDeliveryBooking`
 * mutation in a fixture teardown, so it runs even if the confirmation assertion fails.
 * Cleanup needs an admin bearer token — the SAME token used by e2e/helpers/graphql.ts,
 * read from e2e/.auth/user.json (NOT the deployed-origin storageState, which only holds
 * browser-side Auth0 cache entries, not a token usable for a direct API POST). If that
 * token is missing/expired, or if api-testing has not yet redeployed the
 * deleteDeliveryBooking mutation (it merged to techaid-server dev today), cleanup prints
 * a loud warning identifying the leftover booking rather than failing silently — see
 * warnLeftoverBooking() below.
 */
import { test as base, expect } from '@playwright/test';
import { getBearerToken, UAT_GRAPHQL_ENDPOINT } from '../helpers/graphql';

/** Clearly-marked smoke identity — see file header. Never used for a real donor/recipient. */
const SMOKE_EMAIL = 'tony.anzelmo+live-smoke@communitytechaid.org.uk';
const SMOKE_FIRST_NAME = 'CTA';
const SMOKE_SURNAME = 'LiveSmokeTest';
// Ofcom's reserved drama/fiction number range — guaranteed not to ring a real phone.
const SMOKE_PHONE = '07700900000';
const SMOKE_ADDRESS = 'LIVE-SMOKE TEST BOOKING — safe to ignore/delete, created by e2e/tests/live-booking-smoke.spec.ts';
const SMOKE_POSTCODE = 'SW9 7AA';
const SMOKE_ACCESS_NOTES = 'Automated live-smoke test — no delivery will actually occur.';

/**
 * Booking only succeeds for a device request whose status is exactly
 * PROCESSING_EQUALITIES_DATA_COMPLETE (DeliveryService.kt:196-203 on the server — nothing
 * else is checked). There's no way to invent a reference any more, so this discovers a real,
 * currently-eligible one via the admin API. Not rate-limited (unlike the public eligibility
 * query), so it's safe to call once up front rather than probing candidates through the UI.
 */
async function findEligibleCtaReference(token: string): Promise<number | null> {
  const res = await adminGql<{ deviceRequestConnection: { content: { id: string; status: string }[] } }>(
    token,
    `query {
      deviceRequestConnection(page: { size: 10 }, where: { status: { _eq: PROCESSING_EQUALITIES_DATA_COMPLETE } }) {
        content { id status }
      }
    }`,
  );
  if (res.errors) {
    throw new Error(`deviceRequestConnection query failed — ${JSON.stringify(res.errors)}`);
  }
  const first = res.data?.deviceRequestConnection.content[0];
  return first ? Number(first.id) : null;
}

interface SmokeMarker {
  /** A real, discovered device-request id in PROCESSING_EQUALITIES_DATA_COMPLETE — see
   *  findEligibleCtaReference(). Booking it flips its status; cleanup must restore it. */
  ctaReference: number;
  email: string;
}

interface AdminBookingRow {
  id: string;
  ctaReference: number;
  email: string;
}

async function adminGql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data?: T; errors?: { message: string }[] }> {
  const res = await fetch(UAT_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

function warnLeftoverBooking(marker: SmokeMarker, reason: string): void {
  console.warn(
    `\n${'!'.repeat(72)}\n` +
      `[live-smoke cleanup] COULD NOT CONFIRM CLEANUP of the booking this run may have\n` +
      `created (ctaReference "${marker.ctaReference}", email "${marker.email}").\n` +
      `Reason: ${reason}\n` +
      `ACTION: check the admin Delivery Bookings screen (or query deliveryBookingsAdmin) for a\n` +
      `row matching that ctaReference/email and delete it by hand if present. The linked device\n` +
      `request id ${marker.ctaReference} may also still be stuck in\n` +
      `PROCESSING_COLLECTION_DELIVERY_ARRANGED — check it and, if so, move it back to\n` +
      `PROCESSING_EQUALITIES_DATA_COMPLETE by hand so it remains usable by future smoke runs.\n` +
      `${'!'.repeat(72)}\n`,
  );
}

/**
 * Finds and hard-deletes the booking matching the given marker via the admin
 * `deleteDeliveryBooking(id: ID!, clearRequestDelivery: Boolean)` mutation, passing
 * `clearRequestDelivery: true` so the linked device request (which booking moved to
 * PROCESSING_COLLECTION_DELIVERY_ARRANGED) is released back to its prior status —
 * otherwise every run would permanently burn one of the handful of UAT requests that
 * are currently eligible to book. Never throws — every failure mode (missing/expired
 * token, mutation not yet deployed, booking not found) is reported via
 * warnLeftoverBooking() instead, so a cleanup problem never masks the test's own
 * pass/fail result.
 */
async function cleanupSmokeBooking(marker: SmokeMarker): Promise<void> {
  let token: string;
  try {
    token = getBearerToken();
  } catch (err) {
    warnLeftoverBooking(marker, `no usable bearer token — ${(err as Error).message}`);
    return;
  }

  const listRes = await adminGql<{ deliveryBookingsAdmin: AdminBookingRow[] }>(
    token,
    `query { deliveryBookingsAdmin { id ctaReference email } }`,
  );
  if (listRes.errors) {
    warnLeftoverBooking(marker, `deliveryBookingsAdmin query failed — ${JSON.stringify(listRes.errors)}`);
    return;
  }
  const match = (listRes.data?.deliveryBookingsAdmin ?? []).find(
    (row) => row.ctaReference === marker.ctaReference && row.email === marker.email,
  );
  if (!match) {
    // Nothing to clean up — either the submit never succeeded (e.g. the confirmation
    // assertion failed before the mutation fired), or a previous run already removed it.
    console.log(`[live-smoke cleanup] no booking found matching "${marker.ctaReference}" — nothing to delete.`);
    return;
  }

  const delRes = await adminGql<{ deleteDeliveryBooking: boolean }>(
    token,
    `mutation ($id: ID!, $clear: Boolean) { deleteDeliveryBooking(id: $id, clearRequestDelivery: $clear) }`,
    { id: match.id, clear: true },
  );
  if (delRes.errors || delRes.data?.deleteDeliveryBooking !== true) {
    // Tolerate the mutation not existing yet: it merged to techaid-server dev today
    // and api-testing may not have redeployed. Any other failure gets the same loud
    // warning — either way a human needs to look, but the run doesn't fail for it.
    warnLeftoverBooking(
      marker,
      `deleteDeliveryBooking(id: "${match.id}") did not report success — ` +
        `${delRes.errors ? JSON.stringify(delRes.errors) : 'returned false'} ` +
        `(if api-testing has not redeployed the mutation yet, this is expected — retry later)`,
    );
    return;
  }
  console.log(`[live-smoke cleanup] deleted booking id=${match.id} ctaReference="${marker.ctaReference}".`);
}

const test = base.extend<{ smokeMarker: SmokeMarker }>({
  // eslint-disable-next-line no-empty-pattern
  smokeMarker: async ({}, use, testInfo) => {
    const token = getBearerToken();
    const ctaReference = await findEligibleCtaReference(token);
    testInfo.skip(
      ctaReference === null,
      'UAT has no device request in PROCESSING_EQUALITIES_DATA_COMPLETE right now — ' +
        'move one into that status for this smoke to have something eligible to book.',
    );
    const marker: SmokeMarker = { ctaReference: ctaReference as number, email: SMOKE_EMAIL };
    await use(marker);
    // Runs after the test body completes — success or failure — same as a try/finally.
    await cleanupSmokeBooking(marker);
  },
});

test.describe('live UAT delivery-booking smoke @live-smoke', () => {
  test('books a real delivery slot end to end and shows the confirmation', async ({ page, smokeMarker }) => {
    test.setTimeout(120_000);

    await page.goto('https://app-testing.communitytechaid.org.uk/delivery-booking');

    // Step 1 (reference-first since PR #202): the discovered eligible request id must be
    // entered before availability loads at all.
    const referenceForm = page.locator('form.form').first();
    await expect(referenceForm).toBeVisible({ timeout: 15_000 });
    await referenceForm.locator('input[formControlName="ctaReference"]').fill(String(smokeMarker.ctaReference));
    await referenceForm.locator('button[type="submit"]').click();

    const dayRow = page.locator('.day-row').first();
    await expect(
      dayRow,
      `request id ${smokeMarker.ctaReference} was PROCESSING_EQUALITIES_DATA_COMPLETE moments ago but the ` +
        `day step never rendered — either it was ineligible after all or UAT has no bookable day right now`,
    ).toBeVisible({ timeout: 20_000 });
    const dayLabel = (await dayRow.locator('.day-row__label').innerText()).trim();
    await dayRow.click();

    const windowRow = page.locator('.window-row').first();
    await expect(windowRow, 'the selected day must have at least one window with spots').toBeVisible({ timeout: 15_000 });
    // The window row no longer shows the window's internal `name` (see window-step.component.html) —
    // only its time range, which is also all the details-step slot summary shows.
    const windowTime = (await windowRow.locator('.window-row__time').innerText()).trim();
    await windowRow.click();

    const form = page.locator('form.form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.locator('input[formControlName="firstName"]').fill(SMOKE_FIRST_NAME);
    await form.locator('input[formControlName="surname"]').fill(SMOKE_SURNAME);
    await form.locator('input[formControlName="email"]').fill(SMOKE_EMAIL);
    await form.locator('input[formControlName="phone"]').fill(SMOKE_PHONE);
    // SMOKE_ADDRESS is a single marker string, not a real "street, locality" address, so
    // there's no meaningful split point — it all goes in line 1, line 2 stays empty.
    await form.locator('input[formControlName="addressLine1"]').fill(SMOKE_ADDRESS);
    await form.locator('input[formControlName="postcode"]').fill(SMOKE_POSTCODE);
    await form.locator('input[formControlName="accessNotes"]').fill(SMOKE_ACCESS_NOTES);
    // No ctaReference field here any more — it was collected in step 1 (reference step).

    // Real Cloudflare Turnstile widget — UAT's siteKey is Cloudflare's "always passes"
    // test key, so the managed widget auto-completes without interaction, but it does
    // so asynchronously. Retry the submit click until the confirmation step appears:
    // clicking before the token is issued is a harmless no-op (the component just sets
    // verificationPending and returns), so retrying is safe and avoids a brittle fixed
    // sleep for however long Cloudflare's round trip happens to take.
    //
    // Once a click DOES fire the real submit, the component swaps the whole form out
    // for the confirmation step, so `submitButton` goes stale. Without the early-return
    // guard below, a subsequent retry's `.click()` on that now-detached button would
    // burn Playwright's ~30s default actionability wait before failing — easily
    // exceeding the outer toPass budget even though the booking (and confirmation)
    // already succeeded. Confirmed live: this exact race lost a real UAT run even
    // though the booking was created and the confirmation rendered correctly.
    const submitButton = form.locator('button[type="submit"]');
    const confirmationLabel = page.locator('.step-label--done');
    await expect(async () => {
      if (await confirmationLabel.isVisible().catch(() => false)) {
        return; // a previous attempt's click already succeeded
      }
      await submitButton.click({ timeout: 5_000 });
      await expect(confirmationLabel).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [1_000] });

    // Confirmation step shows the booked slot.
    await expect(page.getByText('Your delivery is booked ✓')).toBeVisible();
    const summary = page.locator('.summary');
    await expect(summary).toContainText(dayLabel);
    await expect(summary).toContainText(windowTime);
    await expect(summary).toContainText(String(smokeMarker.ctaReference));
    await expect(summary).toContainText(SMOKE_ADDRESS);
  });
});
