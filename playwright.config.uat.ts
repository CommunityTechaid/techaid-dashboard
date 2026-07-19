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
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
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
    launchOptions: {
      args: [
        // See playwright.config.ts — fast-fail third-party requests.
        '--host-resolver-rules=' +
          'MAP embed.typeform.com 127.0.0.1,' +
          'MAP api.typeform.com 127.0.0.1,' +
          'MAP *.in.applicationinsights.azure.com 127.0.0.1,' +
          'MAP *.livediagnostics.monitor.azure.com 127.0.0.1,' +
          'MAP dc.services.visualstudio.com 127.0.0.1',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/uat-deployed.json',
      },
      testIgnore: /tabs-debug\.spec\.ts/,
    },
  ],
  // No webServer — tests run directly against the already-deployed UAT site.
});
