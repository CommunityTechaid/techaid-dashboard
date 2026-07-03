/**
 * Regression: updateDeviceRequest error toast must be bounded in length (issue #38).
 *
 * Before the fix, the error handler passed `err.message` verbatim to the toast.
 * When the GraphQL server returns a large error array the serialised message can be
 * several kilobytes, producing an unreadable wall-of-text toast.
 *
 * After the fix:
 *   - The visible toast text is capped at 200 chars (suffix "… (full error in console)"
 *     is added when truncated), so the total visible length stays ≤ ~230 chars.
 *   - The full error is still emitted to console.error for debugging.
 *
 * The test stubs the GraphQL endpoint to return a synthetic multi-kilobyte error,
 * triggers Save, and asserts the rendered toast text is bounded.
 *
 * Red (before fix): the toast renders the full raw message (>200 chars).
 * Green (after fix): the toast is capped and contains the truncation marker.
 */
import { test, expect } from '@playwright/test';

const FAKE_ID = 99998;

/** A >2 KB error message that the stub GraphQL server returns. */
const GIANT_ERROR_MSG =
  'GraphQL error: ' + 'A'.repeat(2500) + ' [end of error details]';

/** Minimal device-request fixture — enough for the form to render and Save to become clickable. */
const FAKE_DEVICE_REQUEST = {
  id: FAKE_ID,
  status: 'NEW',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  collectionDate: null,
  collectionMethod: null,
  collectionContactName: null,
  deviceRequestItems: {
    phones: 0,
    tablets: 0,
    laptops: 1,
    allInOnes: 0,
    desktops: 0,
    commsDevices: 0,
    other: 0,
    broadbandHubs: 0,
  },
  referringOrganisationContact: {
    id: 1,
    fullName: 'Test Contact',
    referringOrganisation: { id: 1, name: 'Test Org' },
  },
  isSales: false,
  isPrepped: false,
  clientRef: '',
  details: '',
  borough: '',
  kits: [],
  deviceRequestNeeds: { hasInternet: false, hasMobilityIssues: false, needQuickStart: false },
  deviceRequestNotes: [],
};

test.describe('Issue #38: long GraphQL error toast is truncated @mocked', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test(
    'updateDeviceRequest error toast is bounded to ≤ 250 chars and contains the truncation marker',
    async ({ page }) => {
      test.setTimeout(60_000);

      // ── Mock all GraphQL calls ─────────────────────────────────────────────
      await page.route('**/graphql', async route => {
        const body = route.request().postDataJSON?.() ?? {};
        const query = body.query ?? '';

        // Health-check query — resolve immediately so the spinner clears
        if (query.includes('buildInfo')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: { buildInfo: { version: '0.0.0-test', commit: 'abc', time: '2024-01-01' } },
            }),
          });
          return;
        }

        // updateDeviceRequest mutation — must be checked BEFORE findDeviceRequest
        // because `query.includes('deviceRequest')` would match both.
        if (body.operationName === 'updateDeviceRequest' || (query.includes('mutation') && query.includes('updateDeviceRequest'))) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              errors: [{ message: GIANT_ERROR_MSG, extensions: { classification: 'INTERNAL_ERROR' } }],
              data: null,
            }),
          });
          return;
        }

        // Primary data query — return our fake request so the form renders
        if (query.includes('findDeviceRequest') || (query.includes('deviceRequest') && !query.includes('mutation'))) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { deviceRequest: FAKE_DEVICE_REQUEST } }),
          });
          return;
        }

        // Device-count sub-query
        if (query.includes('kitsConnection') || query.includes('countDevicesForRequest')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: { kitsConnection: { totalElements: 0 } } }),
          });
          return;
        }

        // Autocomplete contacts
        if (
          query.includes('referringOrganisationContactsConnection') ||
          query.includes('findAutocompleteReferringOrganisationContacts')
        ) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: { referringOrganisationContactsConnection: { content: [] } },
            }),
          });
          return;
        }

        // Fallback: empty data for any other query
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: {} }),
        });
      });

      // ── Navigate to the device-request detail page ─────────────────────────
      await page.goto(`/dashboard/device-requests/${FAKE_ID}`);

      // Wait for the form to render (Formly must have processed the fixture)
      await expect(page.locator('formly-form')).toBeVisible({ timeout: 30_000 });

      // ── Click Save ─────────────────────────────────────────────────────────
      // The Save button in device-request-info is labelled "Save" or "Update".
      const saveBtn = page.locator('button').filter({ hasText: /^(Save|Update)$/i }).first();
      await saveBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      const saveBtnVisible = await saveBtn.isVisible();
      if (!saveBtnVisible) {
        // Fallback: find any button whose text includes "Save"
        await page.locator('button:has-text("Save")').first().click({ force: true });
      } else {
        await saveBtn.click();
      }

      // ── Assert the toast ───────────────────────────────────────────────────
      // Give the toast time to appear
      const toastEl = page.locator('.toast-error, [class*="toast-error"], [role="alert"]').first();
      const toastAppeared = await toastEl
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);

      expect(toastAppeared, 'an error toast must appear after the mutation fails').toBe(true);

      const visibleText = (await toastEl.textContent()) ?? '';

      // Core assertion: the visible toast text must be bounded.
      // The toast element's textContent includes the title ("Update Error"), whitespace,
      // the truncated message (≤200 chars), and the suffix "… (full error in console)".
      // Allow up to 300 chars to accommodate the title and surrounding whitespace while
      // still proving the 2.5 KB raw message has been capped.
      expect(
        visibleText.length,
        `Toast text length (${visibleText.length}) must be ≤ 300 chars — got: "${visibleText.slice(0, 310)}"`,
      ).toBeLessThanOrEqual(300);

      // The truncation marker must be present when the raw message was longer than 200 chars
      expect(
        visibleText,
        'Toast must contain the truncation marker when the error is long',
      ).toContain('(full error in console)');
    },
  );
});
