/**
 * Sweep regression: the Save button on edit forms must remain clickable so that
 * `warnIfFormInvalid` can surface a toast instead of the button silently being
 * disabled. Issue #49 was kit-info specifically; this covers the same fix
 * applied to device-request-info and post-info.
 *
 * The full toast-on-invalid behaviour is covered by
 * kit-required-field-feedback.spec.ts — this smoke test only verifies that the
 * `[disabled]="form.invalid"` binding has been removed across the swept forms.
 */
import { test, expect } from '@playwright/test';

async function fulfillSimple(route: import('@playwright/test').Route, data: any) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

test.describe('Save button clickable sweep @mocked', () => {
  test('device-request-info: Save button is clickable, not [disabled]', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) {
        return fulfillSimple(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      if (body.includes('findDeviceRequest')) {
        return fulfillSimple(route, {
          deviceRequest: {
            id: 6526,
            status: 'NEW',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
            collectionDate: null,
            collectionMethod: null,
            collectionContactName: null,
            deviceRequestItems: { phones: 0, tablets: 0, laptops: 0, allInOnes: 0, desktops: 0, commsDevices: 0, other: 0, broadbandHubs: 0 },
            referringOrganisationContact: null,
            isSales: false,
            isPrepped: false,
            clientRef: 'REF-1',
            details: '',
            borough: '',
            kits: [],
            deviceRequestNeeds: { hasInternet: false, hasMobilityIssues: false, needQuickStart: false },
            deviceRequestNotes: [],
          },
        });
      }
      if (body.includes('countDevicesForRequest')) {
        return fulfillSimple(route, { kitsConnection: { totalElements: 0 } });
      }
      return fulfillSimple(route, {});
    });

    await page.goto('/dashboard/device-requests/6526');
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible();
    // After the fix, `[disabled]` is no longer bound. The button must not carry a
    // `disabled` attribute regardless of form state.
    await expect(saveBtn).not.toHaveAttribute('disabled', /.*/);
  });

  test('post-info: Save button is clickable, not [disabled]', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route('**/graphql', async route => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) {
        return fulfillSimple(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } });
      }
      if (body.includes('findPost')) {
        return fulfillSimple(route, {
          post: {
            id: 1,
            title: 'Test post',
            slug: 'test-post',
            secured: false,
            content: 'Body',
            published: false,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        });
      }
      return fulfillSimple(route, {});
    });

    await page.goto('/dashboard/posts/1');
    // post-info has two tabs: "Post" (default) and "Edit" (form). Switch to Edit.
    await page.locator('a[ngbNavLink]:has-text("Edit")').click();
    await page.locator('formly-form').waitFor({ state: 'visible', timeout: 30_000 });

    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).not.toHaveAttribute('disabled', /.*/);
  });
});
