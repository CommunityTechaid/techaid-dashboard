#!/usr/bin/env node
/**
 * Deployed-origin CSP probe for the public delivery-booking page.
 *
 * WHY THIS EXISTS: CSP is enforced by response headers (staticwebapp.config.json's
 * globalHeaders.Content-Security-Policy), which `ng serve` never sends — the whole
 * Playwright suite runs against a dev server with no CSP at all, so a directive typo
 * (e.g. forgetting `frame-src https://challenges.cloudflare.com`) is invisible to every
 * other e2e spec. It only shows up once a build is actually deployed. This script is the
 * check for that: point it at a real deployed origin and it reports whether the browser
 * is honouring the intended CSP without silently breaking Cloudflare Turnstile.
 *
 * NOT part of CI or the default e2e run. Run it on demand:
 *   - after any change to staticwebapp.config.json (CSP headers) or the Turnstile
 *     integration (turnstile.service.ts, index.html, environment turnstile_site_key)
 *   - after any deploy that touches those, once the deploy has finished rolling out
 *
 * Usage:
 *   node e2e/csp-probe.mjs                                   # UAT (default)
 *   node e2e/csp-probe.mjs https://app.communitytechaid.org.uk   # production
 *
 * Needs an ELIGIBLE request ID to get past the first step (see resolveCtaReference):
 * discovered automatically with the token in e2e/.auth/user.json, or pass
 * CSP_PROBE_REF=<id>. Nothing is ever submitted.
 *
 * GATED ORIGINS: the /delivery-booking route sits behind deliveryBookingVisibleGuard,
 * which redirects to /404 on production while the `delivery-booking` feature flag is off
 * (feature-flag.service.ts: `visible: !isProduction || live`). That is a deliberate
 * configuration state, not a deploy fault — so when the probe lands on /404 it skips the
 * Turnstile assertions (nothing to assert: the widget only loads on the details step) and
 * still verifies CSP on whatever did load. Without this the probe times out on `.day-row`
 * and reports a misleading "Turnstile never loaded" failure, which is exactly what
 * happened on prod 2026-08-12. Once the flag is switched on, the full path runs again
 * with no change here.
 *
 * Exit code 0 = clean (zero CSP violations; Turnstile verified unless the route is gated).
 * Exit code 1 = something failed; the printed report says what.
 */

import { readFileSync } from 'fs';
import { chromium } from 'playwright';

const DEFAULT_ORIGIN = 'https://app-testing.communitytechaid.org.uk';
const BOOKING_PATH = '/delivery-booking';
const origin = (process.argv[2] ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
const url = `${origin}${BOOKING_PATH}`;

/** Informational lines printed at the top of the report. */
const probeNotes = [];

/** Which API each dashboard origin talks to (environment.*.ts `graphql_endpoint`). */
const API_FOR_ORIGIN = {
  'https://app-testing.communitytechaid.org.uk': 'https://api-testing.communitytechaid.org.uk/graphql',
  'https://app.communitytechaid.org.uk': 'https://api.communitytechaid.org.uk/graphql',
};

/**
 * A request ID the reference step will accept. Only a device request in status
 * PROCESSING_EQUALITIES_DATA_COMPLETE is eligible, and they come and go, so none can be
 * hardcoded. In order:
 *   1. CSP_PROBE_REF=<id>  — explicit, e.g. for an origin with no mapped API
 *   2. discovered via the admin API with the bearer token in e2e/.auth/user.json
 *      (the same token save-token.mjs writes; the admin query is not rate-limited,
 *      unlike the public eligibility check)
 */
async function resolveCtaReference() {
  if (process.env.CSP_PROBE_REF) return { id: Number(process.env.CSP_PROBE_REF), source: 'CSP_PROBE_REF' };
  const api = process.env.CSP_PROBE_API ?? API_FOR_ORIGIN[origin];
  if (!api) throw new Error(`no API known for ${origin} — set CSP_PROBE_REF=<eligible request id> or CSP_PROBE_API`);
  let token;
  try {
    const state = JSON.parse(readFileSync(new URL('./.auth/user.json', import.meta.url), 'utf8'));
    for (const o of state.origins ?? []) for (const item of o.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) token ??= JSON.parse(item.value)?.body?.access_token;
    }
  } catch { /* handled below */ }
  if (!token) throw new Error('no bearer token in e2e/.auth/user.json — run e2e/save-token.mjs, or set CSP_PROBE_REF');
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `query { deviceRequestConnection(page: { size: 1 }, where: { status: { _eq: PROCESSING_EQUALITIES_DATA_COMPLETE } }) { content { id } } }`,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) throw new Error(`eligible-request lookup failed: HTTP ${res.status} ${JSON.stringify(json.errors ?? '')}`);
  const id = json.data?.deviceRequestConnection?.content?.[0]?.id;
  if (!id) throw new Error(`no request in PROCESSING_EQUALITIES_DATA_COMPLETE on ${api} — nothing can reach the details step; set CSP_PROBE_REF`);
  return { id: Number(id), source: `discovered via ${new URL(api).host}` };
}

/** CSP-violation records collected via both the securitypolicyviolation event and console text. */
const violations = [];
let turnstileApiResponse = null; // network Response for challenges.cloudflare.com/turnstile/v0/api.js
let turnstileIframeAttached = false;

function report(ok, lines, gated = false) {
  console.log('\n=== CSP probe report ===');
  console.log(`Target: ${url}`);
  for (const line of [...probeNotes, ...lines]) console.log(line);
  if (ok && gated) {
    console.log('\nRESULT: PASS (booking route gated — Turnstile checks skipped)');
    return;
  }
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Installed BEFORE navigation so it catches violations fired during initial page load,
  // not just ones that happen to occur after our own JS has attached listeners.
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
    const text = msg.text();
    if (/content security policy/i.test(text)) {
      violations.push({ source: 'console', detail: text });
    }
  });

  // Match on the parsed hostname, not a substring — a substring check would also
  // match e.g. https://evil.example/challenges.cloudflare.com (CodeQL
  // js/incomplete-url-substring-sanitization).
  const isTurnstileUrl = (u) => {
    try {
      return new URL(u).hostname === 'challenges.cloudflare.com';
    } catch {
      return false;
    }
  };

  page.on('response', (res) => {
    if (isTurnstileUrl(res.url()) && new URL(res.url()).pathname === '/turnstile/v0/api.js') {
      turnstileApiResponse = res;
    }
  });

  page.on('frameattached', (frame) => {
    // Turnstile's challenge iframe is served from challenges.cloudflare.com — the
    // frame's url is often blank at attach time and resolves once it navigates, so
    // check both the immediate url and (later) the frame's eventual url.
    if (isTurnstileUrl(frame.url())) {
      turnstileIframeAttached = true;
    }
  });
  page.on('framenavigated', (frame) => {
    if (isTurnstileUrl(frame.url())) {
      turnstileIframeAttached = true;
    }
  });

  const isNotFoundUrl = (u) => {
    try {
      return new URL(u).pathname.replace(/\/+$/, '').endsWith('/404');
    } catch {
      return false;
    }
  };

  let navigationError = null;
  let bookingGated = false;
  try {
    // domcontentloaded, not networkidle: an SPA with Turnstile and background XHRs can take
    // >30s to go network-idle (timed out once right after a deploy, 2026-09-23). The
    // Promise.race on the reference input / /404 below is the real readiness signal.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Settle into whichever state this origin is in: the booking UI rendered, or the
    // visibility guard's /404 redirect (flag off on production). Racing the two avoids
    // burning the full .day-row timeout on a gated origin. Both branches are legitimate
    // outcomes, so a timeout here is not itself an error — the checks below decide.
    const referenceInput = page.locator('input[formcontrolname="ctaReference"]');
    await Promise.race([
      referenceInput.waitFor({ state: 'visible', timeout: 15_000 }),
      page.waitForURL(isNotFoundUrl, { timeout: 15_000 }),
    ]).catch(() => {});

    if (isNotFoundUrl(page.url())) {
      // Route is gated off at this origin. Turnstile legitimately never loads (it is
      // lazily loaded by the details step, which is unreachable), so asserting on it
      // would be a false failure. CSP is still checked on the loaded page below.
      bookingGated = true;
    } else {
      // Since #202 the flow starts with the request ID: reference → day → window →
      // details. The day list only appears for a request the server says is eligible,
      // so the probe needs a real one (see resolveCtaReference). Nothing is submitted —
      // the probe stops once the details step has mounted Turnstile.
      const ref = await resolveCtaReference();
      probeNotes.push(`Using request ID ${ref.id} (${ref.source}).`);
      await referenceInput.fill(String(ref.id));
      await page.getByRole('button', { name: /continue/i }).click();
      const refError = page.locator('.status--error');
      await Promise.race([
        page.locator('.day-row').first().waitFor({ state: 'visible', timeout: 15_000 }),
        refError.waitFor({ state: 'visible', timeout: 15_000 }),
      ]).catch(() => {});
      if (await refError.isVisible()) {
        throw new Error(`request ID ${ref.id} was rejected at the reference step: "${(await refError.innerText()).trim()}"`);
      }
      // Turnstile is lazily loaded by the details-step component (see
      // turnstile.service.ts) — it never loads on the earlier steps.
      await page.locator('.day-row').first().click({ timeout: 15_000 });
      await page.locator('.window-row').first().click({ timeout: 15_000 });
      // The widget host only appears once the details form has a siteKey configured.
      await page.locator('.turnstile__widget').waitFor({ state: 'attached', timeout: 15_000 });
    }
  } catch (err) {
    navigationError = err;
  }

  // Give Turnstile's async render + iframe attach a moment to complete even if
  // networkidle fired first (Cloudflare's script does follow-up XHRs).
  await page.waitForTimeout(5_000);

  const pageViolations = await page.evaluate(() => window.__cspViolations ?? []);
  for (const v of pageViolations) {
    violations.push({
      source: 'securitypolicyviolation',
      detail: `${v.violatedDirective} blocked ${v.blockedURI} (${v.sourceFile}:${v.lineNumber})`,
    });
  }

  await browser.close();

  const lines = [];
  let ok = true;

  if (bookingGated) {
    lines.push('ℹ Booking route is gated off at this origin — redirected to /404.');
    lines.push('    The `delivery-booking` feature flag is disabled on this environment,');
    lines.push('    so the day picker and Turnstile never render. Turnstile checks skipped;');
    lines.push('    CSP is still verified against the page that did load.');
  } else if (navigationError) {
    ok = false;
    lines.push(`✗ Failed to reach the details step (day → window → form): ${navigationError.message}`);
  } else {
    lines.push('✓ Reached the details step (day → window selected).');
  }

  if (bookingGated) {
    // Deliberately no Turnstile assertions — see above.
  } else if (turnstileApiResponse) {
    const status = turnstileApiResponse.status();
    if (status >= 200 && status < 400) {
      lines.push(`✓ Turnstile api.js loaded (HTTP ${status}).`);
    } else {
      ok = false;
      lines.push(`✗ Turnstile api.js request returned HTTP ${status}.`);
    }
  } else {
    ok = false;
    lines.push('✗ Turnstile api.js never loaded — no network response from challenges.cloudflare.com/turnstile/v0/api.js.');
  }

  if (bookingGated) {
    // Deliberately no Turnstile assertions — see above.
  } else if (turnstileIframeAttached) {
    lines.push('✓ Turnstile challenge iframe attached.');
  } else {
    ok = false;
    lines.push('✗ No Turnstile challenge iframe attached (challenges.cloudflare.com frame never appeared).');
  }

  if (violations.length === 0) {
    lines.push('✓ Zero CSP violations.');
  } else {
    ok = false;
    lines.push(`✗ ${violations.length} CSP violation(s):`);
    for (const v of violations) {
      lines.push(`    [${v.source}] ${v.detail}`);
    }
  }

  report(ok, lines, bookingGated);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('csp-probe: unexpected error —', err);
  process.exit(1);
});
