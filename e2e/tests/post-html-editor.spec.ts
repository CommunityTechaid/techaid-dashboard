/**
 * Cover for the CMS post editor after the Quill removal (#118). Post "Content" is now a plain
 * monospace textarea (formly type `htmleditor`, html-editor.component.ts) with a live preview
 * bound by plain `[innerHTML]` — the same Angular-sanitised path the public pages use.
 *
 * Pins: the stored HTML loads into the textarea verbatim; editing updates the preview; a
 * `<script>` / `onerror` payload never executes and is stripped from the preview; and Save
 * sends exactly the textarea content (an untouched post round-trips byte-identical, which a
 * WYSIWYG editor re-serialising the HTML would not guarantee).
 *
 * Sanity-checked by breaking what it guards: binding the preview through
 * bypassSecurityTrustHtml turns the payload test red.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
}

const BUILD_INFO = { buildInfo: { version: '1.0.0-test', commit: 'abc', time: '2026-01-01T00:00:00Z' } };
const POST_ID = 9101;
// Deliberately awkward: attributes in odd order, entity, newline and trailing space that a
// re-serialising editor would normalise.
const STORED = '<h2 class="x"  id="a">Title &amp; more</h2>\n<p>Initial   content <a href="/x" target="_blank">link</a></p> ';

test.describe('post HTML editor @mocked', () => {
  let saved: string | undefined;

  test.beforeEach(async ({ page }) => {
    saved = undefined;
    await page.route('**/graphql', async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('buildInfo')) return fulfillJson(route, BUILD_INFO);
      if (body.includes('featureFlagsPublic')) return fulfillJson(route, { featureFlagsPublic: [] });
      if (body.includes('findPost')) {
        return fulfillJson(route, {
          post: {
            id: POST_ID, title: 'HTML-POST-TITLE', slug: 'html-post-slug', secured: false,
            content: STORED, published: true,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          },
        });
      }
      if (body.includes('updatePost')) {
        const variables = (route.request().postDataJSON() as { variables?: { data?: { content?: string } } }).variables;
        saved = variables?.data?.content;
        return fulfillJson(route, {
          updatePost: {
            id: POST_ID, content: saved, slug: 'html-post-slug', title: 'HTML-POST-TITLE',
            secured: false, published: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          },
        });
      }
      return fulfillJson(route, {});
    });

    await page.goto(`/dashboard/posts/${POST_ID}`);
    await expect(page.locator('.breadcrumb-item.active', { hasText: 'HTML-POST-TITLE' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Edit' }).click();
  });

  test('loads the stored HTML verbatim, renders it in the preview, and saves it back unchanged', async ({ page }) => {
    test.setTimeout(60_000);
    const source = page.locator('textarea.html-editor-source');
    await expect(source).toBeVisible({ timeout: 15_000 });
    await expect(source).toHaveValue(STORED);
    await expect(page.getByTestId('html-editor-preview').locator('h2')).toHaveText('Title & more');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved, { timeout: 10_000 }).toBe(STORED);
  });

  test('editing updates the preview and Save sends the textarea content', async ({ page }) => {
    test.setTimeout(60_000);
    const source = page.locator('textarea.html-editor-source');
    const html = '<p>Hello <strong>EDITED-MARKER</strong></p>';
    await source.fill(html);
    await expect(page.getByTestId('html-editor-preview').locator('strong')).toHaveText('EDITED-MARKER');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saved, { timeout: 10_000 }).toBe(html);
  });

  // No CSP header here on purpose: with the production CSP the browser blocks inline handlers by
  // itself, which would mask a sanitiser regression. This proves the sanitiser alone does the job.
  test.describe('hostile markup', () => {
    test.use({ productionCsp: false });

    test('a script / onerror payload never executes and is stripped from the preview', async ({ page }) => {
      test.setTimeout(60_000);
      await page.evaluate(() => { (window as any).__pwned = 0; });
      const payload =
        '<p>safe-text</p><script>window.__pwned = 1</script>' +
        '<img src="x" onerror="window.__pwned = 2"><a href="javascript:window.__pwned=3">js</a>';
      await page.locator('textarea.html-editor-source').fill(payload);

      const preview = page.getByTestId('html-editor-preview');
      await expect(preview).toContainText('safe-text');
      await expect(preview.locator('script')).toHaveCount(0);
      const html = await preview.innerHTML();
      expect(html).not.toContain('onerror');
      expect(html).not.toMatch(/href="javascript:/i); // Angular rewrites it to unsafe:javascript:
      // Give a broken image's error handler time to fire if it had survived.
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as any).__pwned)).toBe(0);

      // The editor itself still saves what the staff member typed: the sanitiser acts on display.
      await page.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => saved, { timeout: 10_000 }).toBe(payload);
    });

  });
});
