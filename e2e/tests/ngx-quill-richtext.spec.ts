/**
 * Regression cover for ngx-quill's major bump (30.1.3 to 31.0.1), landed in 92e7387 alongside
 * the Angular 22 upgrade. The rich-text editor is used in exactly one place in this codebase:
 * post-info's "Content" field (`type: 'richtext'` in post-info.component.ts, rendered by
 * src/app/shared/modules/formly/components/richtext.component.ts's `<quill-editor>`). No other
 * component uses it, so this single flow is the whole blast radius.
 *
 * Covers: the editor mounts with its toolbar, existing content loads into it, typed text lands
 * in the contenteditable body, and the edited value propagates all the way to the form model —
 * proving the ControlValueAccessor binding (formControl -> quill-editor -> updatePost mutation)
 * survived the major.
 *
 * Sanity-checked by breaking what it guards: temporarily removing richtext.component.ts's
 * `[formControl]="formControl"` binding turns the "existing content loaded" assertion red (the
 * editor mounts and is empty, since it never receives the model's value) — confirmed, then
 * reverted.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { test, expect, Page, Route } from '@playwright/test';

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };

test.describe('ngx-quill rich-text editor (post content) @mocked', () => {
  test('editor mounts with its toolbar, loads existing content, and typed text reaches the form model', async ({ page }) => {
    test.setTimeout(60_000);

    const postId = 9101;
    let updatePostContent: string | undefined;

    await page.route('**/graphql', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findPost')) {
        return fulfillJson(route, {
          post: {
            id: postId, title: 'QUILL-POST-TITLE', slug: 'quill-post-slug', secured: false,
            content: '<p>Initial content</p>', published: true,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          },
        });
      }
      if (body.includes('updatePost')) {
        const variables = (route.request().postDataJSON() as { variables?: { data?: { content?: string } } }).variables;
        updatePostContent = variables?.data?.content;
        return fulfillJson(route, {
          updatePost: {
            id: postId, content: updatePostContent, slug: 'quill-post-slug', title: 'QUILL-POST-TITLE',
            secured: false, published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          },
        });
      }
      return fulfillJson(route, {});
    });

    await page.goto(`/dashboard/posts/${postId}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'QUILL-POST-TITLE' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('tab', { name: 'Edit' }).click();

    // The editor mounts, with its toolbar.
    const toolbar = page.locator('quill-editor .ql-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    const editorBody = page.locator('quill-editor .ql-editor');
    await expect(editorBody).toBeVisible();

    // Existing content loaded into it.
    await expect(editorBody).toContainText('Initial content');

    // Typed text lands in the contenteditable body.
    await editorBody.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' QUILL-E2E-MARKER');
    await expect(editorBody).toContainText('QUILL-E2E-MARKER');

    // The edited value propagates to the form model and out through the mutation.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => updatePostContent, { timeout: 10_000 }).toContain('QUILL-E2E-MARKER');
  });
});
