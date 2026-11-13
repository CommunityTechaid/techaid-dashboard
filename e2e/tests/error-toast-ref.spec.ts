/**
 * #381 part (d): error toasts show friendly text (or the server's deliberate words) plus the
 * request's ref, never raw internals, and never render server text as HTML.
 *
 * What it pins, on the post edit page's updatePost failure (a staff toast that used to be
 * `<small>${err.message}</small>` with enableHtml):
 *   - an unexpected failure (HTTP 200 errors[] whose message is leaked SQL holding a
 *     personal-data-like sentinel and markup) shows "Something went wrong." and the SAME ref the
 *     request carried in X-CTA-Ref, and none of the server's text;
 *   - a bean-validation message ("updatePost.data.title: must not be blank") is rewritten as
 *     "Please check the details entered: title must not be blank." plus the ref;
 *   - a deliberate message is shown as written plus the ref, and markup in it is shown as text,
 *     not rendered;
 *   - a transport failure (HTTP 503) shows the server-status text plus the ref.
 * A second block runs the classifier (src/app/shared/utils/error-toast.ts) in plain Node for the
 * shapes a page cannot easily produce.
 *
 * @mocked — every GraphQL operation is page.route-stubbed; no bearer token required.
 */
import { Page, Route } from '@playwright/test';
import { test, expect } from '../helpers/csp';
import { CombinedGraphQLErrors } from '@apollo/client';
import {
  describeError, errorToastText, NETWORK_TEXT, SERVER_STATUS_TEXT, UNEXPECTED_TEXT,
} from '../../src/app/shared/utils/error-toast';

const TS = '2026-01-01T00:00:00Z';
const POST_ID = 9381;
/** Looks like personal data a leaked constraint message could carry. */
const SENTINEL = 'sentinel.person.381@example.invalid';
const REF_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

const post = (title: string) => ({
  id: POST_ID, title, slug: 'error-toast-post', secured: false, content: '<p>Body</p>', published: true,
  createdAt: TS, updatedAt: TS,
});

type Failure = { status: number; body: unknown };

async function fulfill(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Stubs GraphQL; updatePost fails with `failure`. Returns the refs the updatePost requests carried. */
async function installMocks(page: Page, failure: Failure): Promise<string[]> {
  const refs: string[] = [];
  await page.route('**/graphql', async route => {
    const body = route.request().postData() ?? '';
    if (body.includes('buildInfo')) return fulfill(route, 200, { data: { buildInfo: { version: '1.0.0-test', commit: 'abc', time: TS } } });
    if (body.includes('featureFlagsPublic')) return fulfill(route, 200, { data: { featureFlagsPublic: [] } });
    if (body.includes('query findPost')) return fulfill(route, 200, { data: { post: post('ERROR-TOAST-POST') } });
    if (body.includes('mutation updatePost')) {
      const headers = await route.request().allHeaders();
      refs.push(headers['x-cta-ref']);
      return fulfill(route, failure.status, failure.body);
    }
    return fulfill(route, 200, { data: {} });
  });
  return refs;
}

/** Opens the post's Edit tab, saves, and returns the error toast and the ref the save carried. */
async function saveAndFail(page: Page, failure: Failure) {
  const refs = await installMocks(page, failure);
  await page.goto(`/dashboard/posts/${POST_ID}`);
  await expect(page.locator('.breadcrumb-item.active', { hasText: 'ERROR-TOAST-POST' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Edit' }).click();
  await expect(page.getByLabel('Title').first()).toHaveValue('ERROR-TOAST-POST', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => refs.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const ref = refs[0];
  expect(ref, 'the request carried a well-formed ref').toMatch(REF_RE);
  const toast = page.locator('.toast-error').first();
  await expect(toast).toBeVisible({ timeout: 10_000 });
  return { toast, message: toast.locator('.toast-message'), ref };
}

test.describe('error toasts show friendly text and the error ref @mocked', () => {
  test('an unexpected server error shows friendly text and the ref, not the server text', async ({ page }) => {
    test.setTimeout(60_000);
    const raw = `could not execute statement; SQL [n/a]; constraint [posts_slug_key]; Key (author)=(${SENTINEL}) `
      + 'already exists <img src="x" id="injected-381">';
    const { message, ref } = await saveAndFail(page, {
      status: 200,
      body: { data: null, errors: [{ message: raw, extensions: { classification: 'DataFetchingException' } }] },
    });
    await expect(message).toHaveText(`${UNEXPECTED_TEXT} Ref: ${ref}`);
    const text = (await message.textContent()) ?? '';
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('constraint');
    await expect(page.locator('#injected-381')).toHaveCount(0);
  });

  test('a validation error is shown as a friendly field message with the ref', async ({ page }) => {
    test.setTimeout(60_000);
    const { message, ref } = await saveAndFail(page, {
      status: 200,
      body: {
        data: null,
        errors: [{ message: 'updatePost.data.title: must not be blank', extensions: { classification: 'DataFetchingException' } }],
      },
    });
    await expect(message).toHaveText(`Please check the details entered: title must not be blank. Ref: ${ref}`);
  });

  test('a deliberate server message is shown as written, as text, with the ref', async ({ page }) => {
    test.setTimeout(60_000);
    const deliberate = 'You cannot edit <em>this</em> post';
    const { message, ref } = await saveAndFail(page, {
      status: 200,
      body: { data: null, errors: [{ message: deliberate, extensions: { classification: 'DataFetchingException' } }] },
    });
    await expect(message).toHaveText(`${deliberate}. Ref: ${ref}`);
    await expect(message.locator('em'), 'server text must not be rendered as HTML').toHaveCount(0);
  });

  test('a transport failure shows the server-status text with the ref', async ({ page }) => {
    test.setTimeout(60_000);
    const { message, ref } = await saveAndFail(page, { status: 503, body: { message: `upstream ${SENTINEL}` } });
    await expect(message).toHaveText(`${SERVER_STATUS_TEXT} Ref: ${ref}`);
  });
});

test.describe('error toast classifier (plain Node) @mocked', () => {
  const gql = (...errors: { message: string; extensions?: Record<string, unknown> }[]) =>
    new CombinedGraphQLErrors({ data: null, errors } as never);

  test('BAD_REQUEST messages are deliberate even when long', () => {
    const long = 'We could not book this delivery because the request is not ready yet. '.repeat(5).trim();
    expect(describeError(gql({ message: long, extensions: { classification: 'BAD_REQUEST' } }))).toMatchObject({ kind: 'deliberate', text: long });
  });

  test('staff deliberate messages keep their wording, including an email address', () => {
    expect(describeError(gql({ message: 'Unable to locate a kit with id: 42' })).text).toBe('Unable to locate a kit with id: 42.');
    expect(describeError(gql({ message: "You cannot delete other user's notes" })).kind).toBe('deliberate');
    expect(describeError(gql({ message: 'Access Denied' })).text).toBe('Access Denied.');
    expect(describeError(gql({ message: 'Please contact distributions@communitytechaid.org.uk.' })).kind).toBe('deliberate');
  });

  test('internals, schema errors and the server generic message are unexpected', () => {
    for (const error of [
      { message: 'Cannot invoke "cta.app.Kit.getId()" because "kit" is null' },
      { message: 'java.lang.IllegalStateException: boom' },
      { message: 'org.hibernate.exception.ConstraintViolationException: could not execute statement' },
      { message: 'Validation error (FieldUndefined@[kit/nope]) : Field nope', extensions: { classification: 'ValidationError' } },
      { message: 'INTERNAL_ERROR for 1b2c', extensions: { classification: 'INTERNAL_ERROR' } },
      { message: 'Something went wrong. Please try again - if it keeps happening, contact Community TechAid quoting reference ABCD2345.' },
      { message: 'x'.repeat(400) },
      { message: '' },
    ]) {
      expect(describeError(gql(error)), error.message).toMatchObject({ kind: 'unexpected', text: UNEXPECTED_TEXT });
    }
  });

  test('several violations are listed by field; the non-null companion error is ignored', () => {
    const err = gql(
      { message: 'createDonor.data.email: must be a well-formed email address, createDonor.data.firstName: must not be blank' },
      { message: "The field at path '/createDonor' was declared as a non null type, but the code involved in retrieving data has wrongly returned a null value.", extensions: { classification: 'NullValueInNonNullableField' } },
    );
    expect(describeError(err)).toMatchObject({
      kind: 'validation',
      text: 'Please check the details entered: email must be a well-formed email address; first name must not be blank.',
    });
  });

  test('transport and non-GraphQL errors, the caller fallback and the prefix', () => {
    expect(describeError({ name: 'HttpErrorResponse', status: 0, error: null }).text).toBe(NETWORK_TEXT);
    expect(describeError({ name: 'HttpErrorResponse', status: 502, error: '<html>bad gateway</html>' }).text).toBe(SERVER_STATUS_TEXT);
    expect(describeError({ name: 'HttpErrorResponse', status: 400, error: { errors: [{ message: 'Access Denied' }] } }).text).toBe('Access Denied.');
    expect(describeError(new Error('TypeError: x is undefined')).text).toBe(UNEXPECTED_TEXT);
    expect(errorToastText(new Error('boom'), { unexpected: 'Could not save.', prefix: 'Half saved: ' })).toBe('Half saved: Could not save.');
  });
});
