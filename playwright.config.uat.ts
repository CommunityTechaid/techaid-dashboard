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
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
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
      },
      testIgnore: /tabs-debug\.spec\.ts/,
    },
  ],
  // No webServer — tests run directly against the already-deployed UAT site.
});
