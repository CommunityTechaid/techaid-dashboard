/**
 * Regression cover for the formly `place` address field (place.component.ts) inside an
 * OnPush host.
 *
 * Since the OnPush fan-out (#114, shipped in #218) the referee index — whose
 * "Create Referee" modal hosts a `place` field — is ChangeDetectionStrategy.OnPush.
 * place.component.ts assigned `this.suggestions` from an HttpClient subscription (and
 * cleared it from a blur setTimeout) without marking the view dirty, so the suggestion
 * list never rendered when the proxy answered: it only appeared on the NEXT keystroke,
 * whose (input) event marked the view for check. Found on deployed UAT 2026-11-10 while
 * verifying #58 (key rotation): the proxy returned 5 predictions, 0 rendered; one more
 * key and the 5 stale predictions appeared within 100ms, before the debounce had fired.
 *
 * The proxy stub deliberately delays its response so it lands in its own macrotask, well
 * after the keystroke's change-detection pass — exactly the live timing. Without the
 * delay a fast stub could be painted by an unrelated CD pass and mask the bug (see the
 * header of onpush-live-repaint.spec.ts on stubbed responses accidentally repainting).
 *
 * @mocked — GraphQL and the Places proxy are page.route-stubbed; no bearer token needed.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { PLACES_PROXY_PATTERN } from '../helpers/places-proxy';

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };

const PREDICTIONS = [
  { description: '10 Downing Street, London, UK', place_id: 'p1' },
  { description: '10 Downing Street Mews, London, UK', place_id: 'p2' },
];

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page): Promise<{ autocompleteCalls: () => number }> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
    if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
    if (body.includes('findAllReferringOrgContacts')) {
      return fulfillJson(route, {
        referringOrganisationContactsConnection: {
          totalElements: 1,
          content: [{
            id: 1, fullName: 'PLACE-ONPUSH-REFEREE', email: 'referee@example.org', phoneNumber: '07700900000',
            requestCount: 0, referringOrganisation: { id: 1, name: 'Org' },
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archived: false,
          }],
        },
      });
    }
    return fulfillJson(route, {});
  });

  let calls = 0;
  await page.route(PLACES_PROXY_PATTERN, async (route) => {
    calls++;
    // Land the response well after the keystroke's change-detection pass (see header).
    await new Promise((r) => setTimeout(r, 400));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictions: PREDICTIONS }) });
  });
  return { autocompleteCalls: () => calls };
}

async function openCreateRefereeAddress(page: Page) {
  await page.goto('/dashboard/referring-organisation-contacts');
  await expect(page.locator('#referring-org-contact-index tbody tr', { hasText: 'PLACE-ONPUSH-REFEREE' }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByText('Create Referee').click();
  const input = page.locator('.modal form-place input');
  await expect(input).toBeVisible();
  return input;
}

test.describe('place field inside an OnPush host @mocked', () => {
  test('Create Referee: suggestions render when the proxy answers, without another keystroke', async ({ page }) => {
    test.setTimeout(60_000);
    const mocks = await installMocks(page);
    const input = await openCreateRefereeAddress(page);
    const items = page.locator('.modal form-place li.list-group-item');

    await input.click();
    await input.pressSequentially('10 Downing St', { delay: 30 });

    // No further input: the list must appear purely from the proxy response.
    await expect.poll(mocks.autocompleteCalls, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(items).toHaveCount(PREDICTIONS.length, { timeout: 5_000 });
    await expect(items.first()).toHaveText(PREDICTIONS[0].description);

    await items.first().dispatchEvent('mousedown');
    await expect(input).toHaveValue(PREDICTIONS[0].description);
    await expect(items).toHaveCount(0);
  });

  test('Create Referee: suggestions disappear on blur without another interaction', async ({ page }) => {
    test.setTimeout(60_000);
    await installMocks(page);
    const input = await openCreateRefereeAddress(page);
    const items = page.locator('.modal form-place li.list-group-item');

    await input.click();
    await input.pressSequentially('10 Downing St', { delay: 30 });
    await expect(items).toHaveCount(PREDICTIONS.length, { timeout: 5_000 });

    // Blur programmatically: a click elsewhere would itself trigger change detection and
    // mask the bug. hideSuggestions() clears the list from a 200ms setTimeout.
    await input.evaluate((el: HTMLInputElement) => el.blur());
    await expect(items).toHaveCount(0, { timeout: 2_000 });
  });
});
