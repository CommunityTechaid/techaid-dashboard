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
const SMOKE_ACCESS_NOTES = 'Automated live-smoke test — no delivery will actually occur.';

/** e.g. 920260719 — one per calendar day, so repeat runs on the same day collide deliberately
 *  (surfaces a leftover-cleanup failure instead of silently piling up rows). ctaReference is a
 *  device request id (schema type Long!), so the marker is numeric; the leading 9 keeps it well
 *  clear of real request ids, and it therefore matches no request and forwards nothing. */
function smokeCtaReference(now = new Date()): number {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return Number(`9${y}${m}${d}`);
}

interface SmokeMarker {
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
      `ACTION: check the admin Delivery Bookings screen (or query deliveryBookingsAdmin)\n` +
      `for a row matching that ctaReference/email and delete it by hand if present.\n` +
      `${'!'.repeat(72)}\n`,
  );
}

/**
 * Finds and hard-deletes the booking matching the given marker via the admin
 * `deleteDeliveryBooking(id: ID!)` mutation. Never throws — every failure mode
 * (missing/expired token, mutation not yet deployed, booking not found) is reported
 * via warnLeftoverBooking() instead, so a cleanup problem never masks the test's own
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
    `mutation ($id: ID!) { deleteDeliveryBooking(id: $id) }`,
    { id: match.id },
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
  smokeMarker: async ({}, use) => {
    const marker: SmokeMarker = { ctaReference: smokeCtaReference(), email: SMOKE_EMAIL };
    await use(marker);
    // Runs after the test body completes — success or failure — same as a try/finally.
    await cleanupSmokeBooking(marker);
  },
});

test.describe('live UAT delivery-booking smoke @live-smoke', () => {
  test('books a real delivery slot end to end and shows the confirmation', async ({ page, smokeMarker }) => {
    test.setTimeout(120_000);

    await page.goto('https://app-testing.communitytechaid.org.uk/delivery-booking');

    const dayRow = page.locator('.day-row').first();
    await expect(dayRow, 'UAT must have at least one bookable day for this smoke to run').toBeVisible({ timeout: 20_000 });
    const dayLabel = (await dayRow.locator('.day-row__label').innerText()).trim();
    await dayRow.click();

    const windowRow = page.locator('.window-row').first();
    await expect(windowRow, 'the selected day must have at least one window with spots').toBeVisible({ timeout: 15_000 });
    const windowName = (await windowRow.locator('.window-row__name').innerText()).trim();
    await windowRow.click();

    const form = page.locator('form.form');
    await expect(form).toBeVisible({ timeout: 15_000 });
    await form.locator('input[formControlName="firstName"]').fill(SMOKE_FIRST_NAME);
    await form.locator('input[formControlName="surname"]').fill(SMOKE_SURNAME);
    await form.locator('input[formControlName="email"]').fill(SMOKE_EMAIL);
    await form.locator('input[formControlName="phone"]').fill(SMOKE_PHONE);
    await form.locator('textarea[formControlName="address"]').fill(SMOKE_ADDRESS);
    await form.locator('input[formControlName="accessNotes"]').fill(SMOKE_ACCESS_NOTES);
    await form.locator('input[formControlName="ctaReference"]').fill(String(smokeMarker.ctaReference));

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
    await expect(summary).toContainText(windowName);
    await expect(summary).toContainText(String(smokeMarker.ctaReference));
    await expect(summary).toContainText(SMOKE_ADDRESS);
  });
});
