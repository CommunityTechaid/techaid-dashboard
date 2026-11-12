/**
 * Production CSP for the @mocked specs.
 *
 * WHY: `ng serve` sends no Content-Security-Policy, but every deployed build (UAT and production)
 * gets the one in src/staticwebapp.config.json from Azure Static Web Apps. Anything the CSP blocks
 * therefore works in the mocked suite and breaks only once deployed. The case that prompted this
 * (2026-11-02, dashboard #267): Formly compiles *string* expressions with new Function(), the CSP
 * has no 'unsafe-eval', and the membership section's string hideExpressions silently stopped
 * hiding anything on UAT. A free organisation's required start date then blocked every save.
 *
 * WHAT: specs import `test` from here instead of '@playwright/test'. An automatic fixture serves
 * every page document with the production CSP header (read from the config file, not copied, so
 * it cannot drift), records CSP violations and eval errors, and fails the test if there are any.
 *
 * Opt out per file or describe block:
 *   test.use({ productionCsp: false });                  // no header at all
 *   test.use({ allowedCspViolations: [/fonts\.googleapis/] });  // tolerate a known violation
 */
import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export { expect };

function readProductionCsp(): string {
  const path = resolve(process.cwd(), 'src/staticwebapp.config.json');
  const csp = JSON.parse(readFileSync(path, 'utf8'))?.globalHeaders?.['Content-Security-Policy'];
  if (!csp) {
    throw new Error(`No globalHeaders["Content-Security-Policy"] in ${path}`);
  }
  return csp;
}

export const PRODUCTION_CSP = readProductionCsp();

/**
 * Messages that mean the CSP blocked something, or that an eval was refused, or (since Formly types are
 * registered lazily by formlyTypesGuard) that a form host rendered without its Formly types registered.
 */
const VIOLATION = /Content Security Policy|EvalError|unsafe-eval|\[Formly Error\] The (type|wrapper|validator) ".*" could not be found/i;

/** Page documents only: no file extension, and never the GraphQL endpoint the specs stub. */
const isDocumentUrl = (url: URL) => !url.pathname.includes('graphql') && !/\.[a-z0-9]+$/i.test(url.pathname);

async function serveWithCsp(page: Page): Promise<void> {
  await page.route(isDocumentUrl, async route => {
    if (route.request().resourceType() !== 'document') {
      return route.fallback();
    }
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': PRODUCTION_CSP },
    });
  });
}

export const test = base.extend<{ productionCsp: boolean; allowedCspViolations: RegExp[] }>({
  productionCsp: [true, { option: true }],
  allowedCspViolations: [[], { option: true }],

  page: async ({ page, productionCsp, allowedCspViolations }, use, testInfo) => {
    if (!productionCsp) {
      return use(page);
    }
    const violations: string[] = [];
    const record = (text: string) => {
      if (VIOLATION.test(text) && !allowedCspViolations.some(re => re.test(text))) {
        violations.push(text.slice(0, 300));
      }
    };
    page.on('console', msg => record(msg.text()));
    page.on('pageerror', err => record(String(err)));
    await serveWithCsp(page);

    await use(page);

    // Only judge a test that otherwise passed: a failure's own error is the better report.
    if (testInfo.status === testInfo.expectedStatus) {
      expect(violations, 'production CSP violations (see e2e/helpers/csp.ts)').toEqual([]);
    }
  },
});
