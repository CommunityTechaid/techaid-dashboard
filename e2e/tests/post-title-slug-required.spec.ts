/**
 * Editing a CMS post must never send a blank `title` or `slug`. The server's UpdatePostInput declares
 * both `String!` + `@NotBlank`, so an emptied field used to send '' and the save failed with a raw
 * server error toast. Both fields are now required on the edit form (post-info), as they already were
 * on the create form (post-index): Save marks the field invalid and sends no mutation.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

const TS = '2026-01-01T00:00:00Z';
const POST_ID = 9131;

const post = (title: string, slug: string) => ({
  id: POST_ID, title, slug, secured: false, content: '<p>Body</p>', published: true, createdAt: TS, updatedAt: TS,
});

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

async function installMocks(page: Page, sent: any[]): Promise<void> {
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, { featureFlagsPublic: [] });
    if (body.includes('query findPost')) return fulfill(route, { post: post('REQUIRED-POST-TITLE', 'required-post-slug') });
    if (body.includes('mutation updatePost')) {
      const data = JSON.parse(body).variables.data;
      sent.push(data);
      return fulfill(route, { updatePost: post(data.title, data.slug) });
    }
    return fulfill(route, {});
  });
}

async function openEdit(page: Page): Promise<void> {
  await page.goto(`/dashboard/posts/${POST_ID}`);
  await expect(page.locator('.breadcrumb-item.active', { hasText: 'REQUIRED-POST-TITLE' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByLabel('Title').first()).toHaveValue('REQUIRED-POST-TITLE', { timeout: 15_000 });
  await expect(page.getByLabel('Slug').first()).toHaveValue('required-post-slug');
}

test.describe('post title and slug are required when editing @mocked', () => {
  test('saving a post with a title and slug sends both', async ({ page }) => {
    test.setTimeout(60_000);
    const sent: any[] = [];
    await installMocks(page, sent);
    await openEdit(page);
    await page.getByLabel('Title').first().fill('EDITED-POST-TITLE');
    await page.getByLabel('Slug').first().fill('edited-post-slug');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    expect(sent[0].title).toBe('EDITED-POST-TITLE');
    expect(sent[0].slug).toBe('edited-post-slug');
  });

  for (const label of ['Title', 'Slug']) {
    test(`emptying the ${label.toLowerCase()} and saving sends no mutation and flags the field`, async ({ page }) => {
      test.setTimeout(60_000);
      const sent: any[] = [];
      await installMocks(page, sent);
      await openEdit(page);
      const input = page.getByLabel(label).first();
      await input.fill('');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.waitForTimeout(1500);
      expect(sent, `no mutation may be sent with a blank ${label.toLowerCase()}`).toHaveLength(0);
      await expect(input).toHaveClass(/is-invalid/);
      await expect(page.locator('.invalid-feedback', { hasText: 'This field is required' }).first()).toBeVisible();
    });
  }
});
