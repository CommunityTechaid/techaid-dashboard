#!/usr/bin/env node
/**
 * Real-Typeform probe for the public request form.
 *
 * WHY THIS EXISTS: the equalities Typeform is injected by org-request.ts only on the public
 * request page (it used to be loaded from index.html on every page). Every Playwright spec
 * either stubs embed.typeform.com or runs under a config that maps it to 127.0.0.1
 * (playwright.config*.ts, --host-resolver-rules), so a green suite says nothing about the real
 * embed script, and e2e/csp-probe.mjs only covers the delivery-booking page. This script is the
 * check against the real third party and, on a deployed origin, the real CSP headers.
 *
 * What it asserts, anonymously, in a plain Chromium with no host remapping:
 *   1. /organisation-device-request fetches the real embed.js (HTTP 200) and widget.css, and
 *      `window.tf.createWidget` becomes a function.
 *   2. Calling `window.tf.createWidget` with the app's form id renders a Typeform iframe that
 *      actually loads (so script-src, style-src and frame-src all allow it).
 *   3. Zero CSP violations on that page.
 *   4. A page that is not the request form (/404) makes no request to embed.typeform.com.
 *
 * NOTHING IS SUBMITTED: the request form is never filled in and createDeviceRequest is blocked
 * at the network as a second guard. The widget is created in a throwaway container, which is
 * the same call ngAfterViewChecked makes after a real submit (that wiring is covered by the
 * mocked spec streamlined-ward-lookup "a successful submit embeds the equalities Typeform").
 *
 * NOT part of CI or the default e2e run. Run it after any deploy that touches org-request's
 * Typeform loader, index.html or the CSP:
 *   node e2e/typeform-probe.mjs                                        # UAT (default)
 *   node e2e/typeform-probe.mjs https://app.communitytechaid.org.uk    # production
 *   node e2e/typeform-probe.mjs http://localhost:4311                  # a local ng serve (no CSP)
 *
 * Exit code 0 = clean. Exit code 1 = something failed; the printed report says what.
 */
import { chromium } from '@playwright/test';

const origin = (process.argv[2] || 'https://app-testing.communitytechaid.org.uk').replace(/\/$/, '');
const FORM_ID = 'f93D0s88'; // must match org-request.ts ngAfterViewChecked
const TYPEFORM_HOST = 'embed.typeform.com';
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};
const isTypeform = url => {
  try { return new URL(url).hostname === TYPEFORM_HOST; } catch { return false; }
};

async function openPage(browser, path) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = { typeform: [], violations: [] };
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  page.on('console', msg => {
    if (/Content Security Policy/i.test(msg.text())) seen.violations.push(msg.text().slice(0, 300));
  });
  page.on('response', res => {
    if (isTypeform(res.url())) seen.typeform.push({ url: res.url(), status: res.status() });
  });
  await page.route('**/graphql', route =>
    (route.request().postData() ?? '').includes('createDeviceRequest') ? route.abort() : route.fallback());
  const response = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return { context, page, seen, csp: response?.headers()['content-security-policy'] };
}

const browser = await chromium.launch();
try {
  console.log(`Typeform probe against ${origin}\n`);

  // --- the public request form ---------------------------------------------------------------
  const form = await openPage(browser, '/organisation-device-request');
  console.log(form.csp ? 'CSP header present on the document.' : 'NOTE: no CSP header on the document (local dev server?).');
  const ready = await form.page
    .waitForFunction(() => typeof window.tf?.createWidget === 'function', null, { timeout: 45_000 })
    .then(() => true, () => false);
  check(ready, 'request form: window.tf.createWidget is available');
  const embed = form.seen.typeform.find(r => r.url.endsWith('/next/embed.js'));
  check(embed?.status === 200, 'request form: real embed.js fetched', embed ? `HTTP ${embed.status}` : 'never requested');
  const css = form.seen.typeform.find(r => r.url.endsWith('/next/css/widget.css'));
  check(css?.status === 200, 'request form: widget.css fetched', css ? `HTTP ${css.status}` : 'never requested');

  if (ready) {
    await form.page.evaluate(id => {
      const container = document.createElement('div');
      container.id = 'tf-probe';
      container.style.cssText = 'width:100%;height:600px';
      document.body.appendChild(container);
      window.tf.createWidget(id, { container, hidden: { borough: 'probe', ward: 'probe', corr_id: 'probe' } });
    }, FORM_ID);
    const iframe = form.page.locator('#tf-probe iframe');
    const attached = await iframe.waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false);
    const src = attached ? await iframe.getAttribute('src') : null;
    check(attached && /typeform\.com/.test(src ?? ''), 'widget: Typeform iframe created', src?.slice(0, 80) ?? 'no iframe');
    if (attached) {
      const frame = await (await iframe.elementHandle()).contentFrame();
      const loaded = await frame?.waitForLoadState('domcontentloaded', { timeout: 30_000 }).then(() => true, () => false);
      const frameUrl = frame?.url() ?? '';
      check(Boolean(loaded) && /typeform\.com/.test(frameUrl), 'widget: iframe document loaded', frameUrl.slice(0, 80));
    }
  }
  await form.page.waitForTimeout(1500);
  const formViolations = [...form.seen.violations, ...(await form.page.evaluate(() => window.__cspViolations))];
  check(formViolations.length === 0, 'request form: no CSP violations', formViolations.join(' | '));
  await form.context.close();

  // --- a page that is not the request form ---------------------------------------------------
  const other = await openPage(browser, '/404');
  await other.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  check(other.seen.typeform.length === 0, 'other page (/404): no request to embed.typeform.com',
    other.seen.typeform.map(r => r.url).join(', '));
  await other.context.close();
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
