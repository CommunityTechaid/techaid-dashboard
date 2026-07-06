import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  // File-level parallelism: fullyParallel stays false so tests inside a spec
  // file run in order, but separate files run on parallel workers. Safe today
  // because no spec performs real UAT writes (action specs stub mutations via
  // page.route). Any future spec that mutates real backend data must either
  // run in a dedicated serial project or keep its writes isolated to records
  // it creates itself.
  // Calibrated 2026-07-03: 2 workers is the sweet spot against the dev-mode
  // ng serve — 4 workers starved it and produced timing flakes (BUG-14,
  // issue-72) with zero net speedup. The deployed-UAT config sustains 4.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  // JSON output feeds e2e/check-skips.mjs (skip-hygiene gate in CI, also
  // runnable after any local suite run).
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        // Fail third-party requests fast instead of waiting on real CDNs:
        // nothing in the suite asserts on the Typeform embed or telemetry.
        // (Google Fonts and wixstatic stay reachable — layout specs measure
        // rendered geometry.)
        '--host-resolver-rules=' +
          'MAP embed.typeform.com 127.0.0.1,' +
          'MAP api.typeform.com 127.0.0.1,' +
          'MAP *.in.applicationinsights.azure.com 127.0.0.1,' +
          'MAP *.livediagnostics.monitor.azure.com 127.0.0.1,' +
          'MAP dc.services.visualstudio.com 127.0.0.1',
      ],
    },
  },
  // Fast inner-loop subset: `npm run e2e:fast` runs only specs tagged @mocked
  // (fully page.route-stubbed, no live UAT data dependency) — ~20s.
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'ng serve --configuration uat-local',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
