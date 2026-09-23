import { defineConfig, devices } from '@playwright/test';

// See playwright.config.ts for why this can't be a static grepInvert: config-level
// grep/grepInvert and CLI --grep are independent filters that AND together, so a
// blanket exclusion here would also block the documented opt-in invocation.
function isLiveSmokeExplicitlyRequested(): boolean {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--grep' || argv[i] === '-g') && argv[i + 1]?.includes('@live-smoke')) {
      return true;
    }
    const eq = argv[i].match(/^(?:--grep|-g)=(.*)$/);
    if (eq && eq[1].includes('@live-smoke')) {
      return true;
    }
  }
  return false;
}
const excludeLiveSmokeByDefault = !isLiveSmokeExplicitlyRequested();

/**
 * Playwright config for running tests against the deployed UAT front-end at
 * app-testing.communitytechaid.org.uk — Option B, as opposed to the default
 * playwright.config.ts which spins up a local ng serve against the same API.
 *
 * Usage:
 *   npx playwright test --config playwright.config.uat.ts
 *   npx playwright test --config playwright.config.uat.ts bugs
 *
 * Auth setup (run once, or when token expires):
 *   $env:E2E_BEARER_TOKEN="eyJ..."
 *   node e2e/save-token.mjs
 *   (save-token.mjs writes both e2e/.auth/user.json and e2e/.auth/uat-deployed.json)
 */
export default defineConfig({
  testDir: './e2e/tests',
  // Excluded by default — see the comment above isLiveSmokeExplicitlyRequested.
  grepInvert: excludeLiveSmokeByDefault ? /@live-smoke/ : undefined,
  // File-level parallelism — see the note in playwright.config.ts. This config
  // has no local dev-server bottleneck (tests hit the deployed SWA host), so it
  // sustains 4 workers cleanly (calibrated 2026-07-03: 4.3m serial → 3.4m).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A full UAT_CROSS_BROWSER run drives 3 browser projects at once (up to 4 workers
  // each, so up to ~12 concurrent browser contexts locally) — real contention that
  // the single-project chromium-only run never sees. One retry absorbs that without
  // masking a genuinely broken assertion (a test that never passes still fails).
  retries: process.env.CI ? 2 : (process.env.UAT_CROSS_BROWSER ? 1 : 0),
  // Cross-browser opt-in runs 3 projects concurrently, so 4 workers means up to ~12
  // browser processes fighting for CPU at once locally. That contention is enough to
  // delay a mocked GraphQL page.route() handler past the app's own "slow server"
  // detection, which swaps the routed view for a full-page retry banner mid-test —
  // an environment artefact, not a bug. Halve the workers for that scenario only.
  workers: process.env.CI ? 2 : (process.env.UAT_CROSS_BROWSER ? 2 : 4),
  // JSON output feeds e2e/check-skips.mjs (same skip-hygiene check as the
  // local config).
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  timeout: 60_000,
  use: {
    baseURL: 'https://app-testing.communitytechaid.org.uk',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/uat-deployed.json',
        launchOptions: {
          // Chromium-only flag (Firefox/WebKit reject it). See playwright.config.ts —
          // fast-fail third-party requests.
          args: [
            '--host-resolver-rules=' +
              'MAP embed.typeform.com 127.0.0.1,' +
              'MAP api.typeform.com 127.0.0.1,' +
              'MAP *.in.applicationinsights.azure.com 127.0.0.1,' +
              'MAP *.livediagnostics.monitor.azure.com 127.0.0.1,' +
              'MAP dc.services.visualstudio.com 127.0.0.1',
          ],
        },
      },
      testIgnore: /tabs-debug\.spec\.ts/,
    },
    // Cross-browser pass against the deployed build — opt in with UAT_CROSS_BROWSER=1
    // (e.g. before a prod deploy). Off by default: it triples the run time and the live
    // write-flow specs' UAT residue.
    //   UAT_CROSS_BROWSER=1 npx playwright test --config playwright.config.uat.ts --project=firefox --project=webkit
    ...(process.env.UAT_CROSS_BROWSER ? [
      {
        name: 'firefox',
        use: {
          ...devices['Desktop Firefox'],
          storageState: 'e2e/.auth/uat-deployed.json',
          // Firefox advertises zstd in Accept-Encoding. The real-UAT write-flow specs'
          // withAuthInterceptor helper re-forwards that header verbatim to the live API
          // via route.fetch() (Node/undici, which doesn't decode zstd), so it comes back
          // as raw zstd bytes with Content-Encoding: zstd still on the response. Fulfilling
          // that response back to the page hands the compressed bytes straight to
          // response.json(), which throws a SyntaxError on the zstd magic bytes — the app
          // itself never sees this, it's an artefact of the interceptor's passthrough.
          // Dropping zstd from what Firefox offers avoids it without touching the app.
          extraHTTPHeaders: { 'Accept-Encoding': 'gzip, deflate, br' },
        },
        testIgnore: /tabs-debug\.spec\.ts/,
      },
      {
        name: 'webkit',
        use: { ...devices['Desktop Safari'], storageState: 'e2e/.auth/uat-deployed.json' },
        testIgnore: /tabs-debug\.spec\.ts/,
      },
    ] : []),
  ],
  // No webServer — tests run directly against the already-deployed UAT site.
});
