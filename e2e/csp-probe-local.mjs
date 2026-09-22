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
 * the fonts/icons that matter actually loaded.
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
    await page.goto(`${ORIGIN}/organisation-device-request`, { waitUntil: 'networkidle', timeout: 30_000 });
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

  // ── Public: delivery-booking page ───────────────────────────────────────
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const acc = await withCspTracking(page);
    await page.goto(`${ORIGIN}/delivery-booking`, { waitUntil: 'networkidle', timeout: 30_000 }).catch((e) => {
      results.push(`\nnavigation note: ${e.message}`);
    });
    await page.waitForTimeout(2_000);
    results.push(`\nFinal URL: ${page.url()} (gated by deliveryBookingVisibleGuard — /404 is expected here on a production build whose feature flag reads FALSE)`);
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

    // The app-shell gates all routed content behind a health-check (BackendStatusService
    // polling `{ buildInfo }`) that shows a "Server is starting up" spinner until it
    // succeeds. The real prod API (baked into this production build) does not CORS-allow
    // http://localhost:4400, so left unstubbed this spins for up to 60s before falling
    // into its error/Retry state. Stub ONLY that probe — every other GraphQL request (the
    // actual device-request data) still goes to the real, CORS-blocked endpoint untouched,
    // so we're still exercising the real CSP/asset behaviour end to end.
    await page.route('**/graphql', async (route) => {
      const postData = route.request().postData() ?? '';
      if (postData.includes('buildInfo')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { buildInfo: { version: 'local', commit: 'local', time: new Date().toISOString() } } }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${ORIGIN}/dashboard/device-requests`, { waitUntil: 'networkidle', timeout: 30_000 });
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
