/**
 * Regression: the bulk-assign modal must name the failure, never render "[object Object]".
 *
 * Reported from production on 2026-08-20 — the modal showed
 * "Device 16348: [object Object]" for a device the server had in fact assigned successfully.
 *
 * Cause, in two parts. `extractGraphQLError` (and three sibling readers) tested `err.graphQLErrors`
 * and `err.networkError`; Apollo Client v4 removed both, because the v3 -> v4 migration (issue #39,
 * PR #69) did not carry the error readers across. That alone only costs a good message — the
 * handler's last resort was `err instanceof Error ? err.message : String(err)`. What makes it
 * render "[object Object]" is that apollo-angular sends its requests through Angular's `HttpClient`,
 * so a non-2xx arrives as an `HttpErrorResponse`, which is **not an `Error` subclass**. Every
 * branch missed, `instanceof Error` was false, and `String(err)` did the rest.
 *
 * This spec drives that exact path: a non-2xx whose body is nonetheless a well-formed GraphQL
 * error, which is what the API returns when a guard rejects an assignment.
 *
 * Red (before the fix): the row reads "Device 16348: [object Object]" — verified, character for
 *   character the production symptom.
 * Green (after the fix): `errorText` recovers `errors[0].message` from `HttpErrorResponse.error`
 *   and the operator reads what the server actually said.
 */
import { test, expect } from '@playwright/test';

const FAKE_ID = 99997;
const FAKE_KIT_ID = 16348;

/** The message the server wrote into the body of its 500. This is what the operator must see. */
const SERVER_MESSAGE =
  'Kit 16348 cannot be assigned to a device request: blocking flags set (wipeFailed)';

/** Minimal device-request fixture — enough for the detail page and its Assign Devices modal. */
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

test.describe('Bulk assign renders the real error, not "[object Object]" @mocked', () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a non-200 carrying a GraphQL error body surfaces the server message', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route('**/graphql', async route => {
      const body = route.request().postDataJSON?.() ?? {};
      const query = body.query ?? '';

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

      // Must be matched before the findDeviceRequest branch — both mention "deviceRequest".
      if (
        body.operationName === 'assignKitsToDeviceRequest' ||
        (query.includes('mutation') && query.includes('assignKitsToDeviceRequest'))
      ) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ errors: [{ message: SERVER_MESSAGE }] }),
        });
        return;
      }

      if (query.includes('findDeviceRequest') || (query.includes('deviceRequest') && !query.includes('mutation'))) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { deviceRequest: FAKE_DEVICE_REQUEST } }),
        });
        return;
      }

      if (query.includes('kitsConnection') || query.includes('countDevicesForRequest')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { kitsConnection: { totalElements: 0 } } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      });
    });

    await page.goto(`/dashboard/device-requests/${FAKE_ID}`);
    await expect(page.locator('formly-form')).toBeVisible({ timeout: 30_000 });

    // Drive the modal: open -> type an id -> Assign -> Confirm.
    await page.getByTestId('devreq-assign-open').click();
    await page.locator('#assignDeviceInput').fill(String(FAKE_KIT_ID));
    await page.getByTestId('devreq-assign-prepare').click();
    await page.getByTestId('devreq-assign-confirm').click();

    // The row, not the `<strong>` label inside it — the message is the label's sibling text node,
    // so getByText would match the label alone and never see the message at all.
    const resultRow = page
      .locator('.modal-body div.mb-1')
      .filter({ hasText: `Device ${FAKE_KIT_ID}:` })
      .first();
    await expect(resultRow).toBeVisible({ timeout: 20_000 });

    const text = (await resultRow.textContent()) ?? '';

    expect(text, 'the assignment result must never render a stringified object').not.toContain(
      '[object Object]',
    );
    expect(
      text,
      `the operator must see the server's own message — got: "${text}"`,
    ).toContain(SERVER_MESSAGE);
  });
});
