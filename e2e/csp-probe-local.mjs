#!/usr/bin/env node
/**
 * Local production-artifact CSP probe.
 *
 * WHY THIS EXISTS: csp-probe.mjs (sibling script) checks a *deployed* origin. But three
 * things only exist once `ng build --configuration production` has actually run — and
 * never show up against `ng serve`, which sends no CSP header at all:
 *   1. FontAwesome is subsetted at build time (build/fa-subset.mjs) into fingerprinted
 *      woff2 files.
 *   2. Poppins is self-hosted the same way (also fingerprinted).
 *   3. The CSP itself (staticwebapp.config.json) intentionally has no Google Fonts
 *      origins in style-src/font-src — if anything still reaches for one, that request
 *      is silently blocked on a real deploy and the page falls back to a system font.
 * The whole e2e suite otherwise only ever exercises `ng serve`, so a regression in any
 * of the three would ship invisibly. This script serves the actual `dist/` output with
 * the exact headers from staticwebapp.config.json (read, not hardcoded, so it stays
 * honest if the CSP changes) and drives the public and an authenticated admin surface
 * against it, watching for CSP violations, stray Google Fonts requests, and confirming
 * the fonts/icons that matter actually loaded. It also walks the public delivery-booking
 * flow (the only surface carrying Cloudflare Turnstile — script-src/frame-src both list
 * challenges.cloudflare.com) far enough to confirm the widget script loads and its
 * challenge iframe attaches, since a CSP mistake there would leave the public form
 * unsubmittable while looking fine everywhere else.
 *
 * All page.goto calls use waitUntil: 'load' rather than 'networkidle': the UAT build's
 * baked-in graphql_endpoint (api-testing.communitytechaid.org.uk) doesn't reject CORS as
 * fast as the production build's does, so 'networkidle' can spin past its own timeout
 * waiting for background XHRs (telemetry, retries) to go quiet.
 *
 * NOT part of CI (needs a pre-built dist/ and a bearer token for the admin check) and not
 * part of the default e2e run. Run it on demand, same triggers as csp-probe.mjs:
 *   - after any change to staticwebapp.config.json, fa-subset.mjs, or the Poppins/FA
 *     stylesheet wiring in sb-admin.css
 *   - before a UAT deploy, as a final artifact sanity check
 *
 * Usage:
 *   npx ng build --configuration production
 *   npm run e2e:csp-probe-local
 *
 * The authenticated admin check needs e2e/.auth/user.json (see e2e/save-token.mjs) — its
 * storageState hardcodes origin http://localhost:4200, so this script patches an in-memory
 * copy to this script's own port before handing it to Playwright. Nothing under e2e/.auth/
 * is read into a file this script writes, so there's nothing new to gitignore.
 *
 * Exit code 0 = clean (zero CSP violations, zero stray Google Fonts requests).
 * Exit code 1 = something failed; the printed report says what.
 */

import { createServer } from 'node:http';
import { readFile, stat, access } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DIST_DIR = join(REPO_ROOT, 'dist');
const CONFIG_PATH = join(REPO_ROOT, 'src', 'staticwebapp.config.json');
const AUTH_STATE_PATH = join(REPO_ROOT, 'e2e', '.auth', 'user.json');
const PORT = 4400;
const ORIGIN = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function startServer(globalHeaders) {
  async function resolveFile(urlPath) {
    const safePath = decodeURIComponent(urlPath.split('?')[0]).replace(/\.\.+/g, '');
    const candidate = join(DIST_DIR, safePath);
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      // fall through to SPA fallback
    }
    return null;
  }

  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(globalHeaders)) {
      res.setHeader(key, value);
    }
    let filePath = (await resolveFile(req.url ?? '/')) ?? join(DIST_DIR, 'index.html');
    try {
      const body = await readFile(filePath);
      res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
      res.statusCode = 200;
      res.end(body);
    } catch (err) {
      res.statusCode = 500;
      res.end(`Server error: ${err.message}`);
    }
  });

  await new Promise((resolve) => server.listen(PORT, resolve));
  return server;
}

const results = [];
let anyViolation = false;
let anyGoogleFontRequest = false;

function section(title) {
  results.push(`\n=== ${title} ===`);
}

async function withCspTracking(page) {
  const violations = [];
  const googleFontRequests = [];
  const pageErrors = [];
  const failedRequests = [];

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
      });
    });
  });
  page.on('console', (msg) => {
    if (/content security policy|refused to/i.test(msg.text())) {
      violations.push({ source: 'console', detail: msg.text() });
    }
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const trackFontReq = (req, status) => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(req.url())) {
      googleFontRequests.push({ url: req.url(), status });
    }
  };
  page.on('requestfinished', (req) => trackFontReq(req, 'finished'));
  page.on('requestfailed', (req) => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(req.url())) {
      trackFontReq(req, `failed: ${req.failure()?.errorText}`);
    } else {
      failedRequests.push({ url: req.url(), error: req.failure()?.errorText });
    }
  });

  return { violations, googleFontRequests, pageErrors, failedRequests };
}

/**
 * Stubs `**\/graphql` POSTs whose body matches one of `matchers` (checked in order,
 * first match wins) with the given fulfil data; anything else passes through to the
 * real (CORS-blocked, from this origin) network so the rest of the CSP/asset behaviour
 * is still exercised against the genuine endpoint.
 *
 * `buildInfo` is always stubbed: BackendStatusService polls it app-wide (every route,
 * not just authenticated ones) and gates the whole router-outlet behind a "Server is
 * starting up" spinner until it resolves. Left unstubbed, EVERY page in this harness
 * — including the two public ones — never renders its actual routed component at all,
 * which would make every check below pass vacuously against a spinner.
 */
async function stubGraphQL(page, matchers = []) {
  await page.route('**/graphql', async (route) => {
    const postData = route.request().postData() ?? '';
    if (postData.includes('buildInfo')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { buildInfo: { version: 'local', commit: 'local', time: new Date().toISOString() } } }),
      });
      return;
    }
    for (const [test, data] of matchers) {
      if (test(postData)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
        return;
      }
    }
    await route.continue();
  });
}

async function drain(page, acc) {
  const pageViolations = await page.evaluate(() => window.__cspViolations ?? []);
  for (const v of pageViolations) {
    acc.violations.push({
      source: 'securitypolicyviolation',
      detail: `${v.violatedDirective} blocked ${v.blockedURI} (${v.sourceFile}:${v.lineNumber})`,
    });
  }
}

function report(label, acc) {
  section(label);
  if (acc.violations.length === 0) {
    results.push('✓ Zero CSP violations.');
  } else {
    anyViolation = true;
    results.push(`✗ ${acc.violations.length} CSP violation(s):`);
    for (const v of acc.violations) results.push(`    [${v.source}] ${v.detail}`);
  }
  if (acc.googleFontRequests.length === 0) {
    results.push('✓ No request to fonts.googleapis.com / fonts.gstatic.com.');
  } else {
    anyGoogleFontRequest = true;
    results.push(`✗ ${acc.googleFontRequests.length} request(s) to Google Fonts:`);
    for (const g of acc.googleFontRequests) results.push(`    ${g.url} — ${g.status}`);
  }
  results.push(acc.pageErrors.length === 0
    ? '✓ No pageerror.'
    : `pageerror(s): ${acc.pageErrors.join(' | ')}`);
  results.push(acc.failedRequests.length === 0
    ? '✓ No other failed requests.'
    : `failed request(s) (non-font, see report notes above for CORS caveat): ${acc.failedRequests.map((f) => f.url).join(', ')}`);
}

async function main() {
  await access(DIST_DIR).catch(() => {
    console.error(`dist/ not found at ${DIST_DIR} — run 'npx ng build --configuration production' first.`);
    process.exit(1);
  });

  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const globalHeaders = config.globalHeaders ?? {};
  const server = await startServer(globalHeaders);

  const browser = await chromium.launch();

  // ── Public: org-request page ────────────────────────────────────────────
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const acc = await withCspTracking(page);
    await stubGraphQL(page);
    await page.goto(`${ORIGIN}/organisation-device-request`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2_000);

    const fontInfo = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [];
      document.fonts.forEach((f) => { if (/poppins/i.test(f.family) && f.status === 'loaded') faces.push(`${f.family} ${f.weight} ${f.style}`); });
      return { faces, bodyFont: getComputedStyle(document.body).fontFamily };
    });
    results.push(`\nPoppins faces loaded: ${fontInfo.faces.length ? fontInfo.faces.join('; ') : 'NONE'}`);
    results.push(`body computed font-family: ${fontInfo.bodyFont}`);

    const faInfo = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.className = 'fas fa-filter';
      probe.style.position = 'fixed';
      probe.style.fontSize = '32px';
      document.body.appendChild(probe);
      const rect = probe.getBoundingClientRect();
      const result = { width: rect.width, height: rect.height, fontFamily: getComputedStyle(probe).fontFamily };
      probe.remove();
      return result;
    });
    results.push(`FontAwesome fa-filter glyph box: ${faInfo.width}x${faInfo.height} (font-family: ${faInfo.fontFamily})`);

    await drain(page, acc);
    report('org-request (/organisation-device-request)', acc);
    await context.close();
  }

  // ── Public: delivery-booking page — the only surface carrying Turnstile ────
  //
  // deliveryBookingVisibleGuard reads `!isProduction || live`, where `live` comes from
  // the `featureFlagsPublic` GraphQL query. On a production build `isProduction` is
  // baked true, so the guard's outcome hinges entirely on that query resolving with the
  // flag on. From this unlisted origin it never would (real CORS rejection, same as
  // every other GraphQL call in this harness) — so left unstubbed the guard fails
  // CLOSED and redirects to /404 regardless of the flag's real value on a live deploy.
  // Stub it (plus eligibility/availability, so the reference → day → window → details
  // steps can actually be walked) to reach the page that matters.
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const acc = await withCspTracking(page);

    let turnstileApiResponse = null;
    let turnstileIframeAttached = false;
    const isTurnstileUrl = (u) => { try { return new URL(u).hostname === 'challenges.cloudflare.com'; } catch { return false; } };
    page.on('response', (res) => {
      if (isTurnstileUrl(res.url()) && new URL(res.url()).pathname === '/turnstile/v0/api.js') turnstileApiResponse = res;
    });
    page.on('frameattached', (f) => { if (isTurnstileUrl(f.url())) turnstileIframeAttached = true; });
    page.on('framenavigated', (f) => { if (isTurnstileUrl(f.url())) turnstileIframeAttached = true; });

    await stubGraphQL(page, [
      [(d) => d.includes('featureFlagsPublic'), { featureFlagsPublic: [{ key: 'delivery-booking', enabled: true }] }],
      [(d) => d.includes('deliveryBookingEligibilityPublic'), { deliveryBookingEligibilityPublic: { eligible: true, message: null } }],
      [(d) => d.includes('deliveryAvailabilityPublic'), {
        deliveryAvailabilityPublic: [{
          date: '2099-01-05', dayOfWeek: 'MONDAY', dayLabel: 'Monday 5 January',
          windows: [{ spotsRemaining: 3, window: { id: 'w1', name: '10 - 4', startTime: '10:00', endTime: '16:00' } }],
        }],
      }],
    ]);

    await page.goto(`${ORIGIN}/delivery-booking`, { waitUntil: 'load', timeout: 30_000 }).catch((e) => {
      results.push(`\nnavigation note: ${e.message}`);
    });
    await page.waitForTimeout(1_000);
    results.push(`\nFinal URL: ${page.url()}`);

    let flowNote = '';
    if (/\/404$/.test(page.url())) {
      flowNote = 'Guard still redirected to /404 even with featureFlagsPublic stubbed enabled — investigate the guard, this is unexpected.';
    } else {
      // Step 1: reference. Step 2: day. Step 3: window. Step 4: details (Turnstile).
      const refInput = page.locator('input[formcontrolname="ctaReference"]');
      const refReached = await refInput.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
      if (refReached) {
        await refInput.fill('4298');
        await page.locator('button[type=submit]', { hasText: /continue/i }).click();
        const dayReached = await page.locator('.day-row').first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
        if (dayReached) {
          await page.locator('.day-row').first().click();
          const windowReached = await page.locator('.window-row').first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
          if (windowReached) {
            await page.locator('.window-row').first().click();
            const detailsReached = await page.locator('.turnstile__widget').waitFor({ state: 'attached', timeout: 10_000 }).then(() => true).catch(() => false);
            flowNote = `Reached details step (Turnstile host attached: ${detailsReached}).`;
            if (detailsReached) {
              // Exercise the address autocomplete field — a real request to the CF
              // worker proxy (cta-places-proxy.community-techaid.workers.dev), allowed
              // by connect-src. Typing, not selecting, is enough to trigger it.
              const addressInput = page.locator('input[formcontrolname="addressLine1"]');
              await addressInput.fill('12 Coldharbour Lane');
              await page.waitForTimeout(1_000); // clears the 300ms debounce
            }
          } else {
            flowNote = 'Day step reached but no .window-row appeared after clicking a day.';
          }
        } else {
          flowNote = 'Reference step submitted but no .day-row appeared — availability stub may not match.';
        }
      } else {
        flowNote = 'Reference-step input never appeared.';
      }
    }
    results.push(flowNote);

    // Give Turnstile's async render + iframe attach a moment even after the page's own
    // 'load' event (Cloudflare's script does follow-up XHRs after it fires).
    await page.waitForTimeout(5_000);

    if (turnstileApiResponse) {
      const status = turnstileApiResponse.status();
      results.push(status >= 200 && status < 400
        ? `✓ Turnstile api.js loaded (HTTP ${status}).`
        : `✗ Turnstile api.js request returned HTTP ${status}.`);
    } else {
      results.push('✗ Turnstile api.js never loaded — no network response from challenges.cloudflare.com/turnstile/v0/api.js.');
    }
    results.push(turnstileIframeAttached
      ? '✓ Turnstile challenge iframe attached.'
      : '✗ No Turnstile challenge iframe attached.');

    await drain(page, acc);
    report('delivery-booking (/delivery-booking)', acc);
    await context.close();
  }

  // ── Authenticated admin: dashboard/device-requests (modal/ng-select/filter) ──
  const hasAuthState = await access(AUTH_STATE_PATH).then(() => true).catch(() => false);
  if (!hasAuthState) {
    section('dashboard/device-requests (authenticated) — SKIPPED');
    results.push(`No e2e/.auth/user.json found. Run 'npm run e2e:save-token' with a fresh E2E_BEARER_TOKEN first.`);
  } else {
    const raw = JSON.parse(await readFile(AUTH_STATE_PATH, 'utf8'));
    const storageState = { ...raw, origins: raw.origins.map((o) => ({ ...o, origin: ORIGIN })) };
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    const acc = await withCspTracking(page);
    await stubGraphQL(page);

    await page.goto(`${ORIGIN}/dashboard/device-requests`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    results.push(`\nFinal URL after auth nav: ${page.url()}`);

    const filterBtn = page.locator('a.btn-info', { hasText: /filter/i });
    if (await filterBtn.isVisible().catch(() => false)) {
      await filterBtn.click();
      const modalDialog = page.locator('.modal-dialog');
      const modalAppeared = await modalDialog.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
      results.push(`Modal opened: ${modalAppeared}`);
      if (modalAppeared) {
        const ngSelect = modalDialog.locator('ng-select').first();
        if (await ngSelect.count()) {
          await ngSelect.click();
          const firstOption = page.locator('.ng-dropdown-panel .ng-option').first();
          const optionAppeared = await firstOption.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
          results.push(`ng-select dropdown opened, option visible: ${optionAppeared}`);
          if (optionAppeared) {
            await firstOption.click();
            // Click the modal header, not Escape — Escape can bubble past the ng-select
            // overlay and dismiss the NgbModal itself.
            await modalDialog.locator('.modal-header').click({ force: true }).catch(() => {});
            await page.locator('.ng-dropdown-panel').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
          }
        }
        const applyBtn = modalDialog.locator('.modal-footer button', { hasText: 'Filter' });
        if (await applyBtn.isVisible().catch(() => false)) {
          await applyBtn.click({ force: true, timeout: 10_000 }).catch((e) => results.push(`Filter apply click failed: ${e.message.split('\n')[0]}`));
          results.push('Filter apply button clicked.');
        }
      }
    } else {
      results.push('Filter button not visible — skipped modal/ng-select/filter interaction.');
    }

    await page.waitForTimeout(1_000);
    await drain(page, acc);
    report('dashboard/device-requests (authenticated)', acc);
    await context.close();
  }

  await browser.close();
  server.close();

  console.log(results.join('\n'));
  const ok = !anyViolation && !anyGoogleFontRequest;
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('csp-probe-local: unexpected error —', err);
  process.exit(1);
});
