import { defineConfig, devices } from '@playwright/test';

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
  // File-level parallelism — see the note in playwright.config.ts. This config
  // has no local dev-server bottleneck (tests hit the deployed SWA host), so it
  // sustains 4 workers cleanly (calibrated 2026-07-03: 4.3m serial → 3.4m).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'html',
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
