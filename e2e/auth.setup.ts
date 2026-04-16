import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth/user.json');

/**
 * Auth setup: logs in once via Auth0 and saves browser storage state.
 *
 * Run this manually first time (or when session expires):
 *   npx playwright test --project=setup
 *
 * The saved state is reused by all other tests via playwright.config.ts.
 *
 * Because authentication.service.ts now uses cacheLocation: 'localstorage',
 * the Auth0 token survives page reloads and can be captured in storageState.
 */
setup('authenticate', async ({ page }) => {
  await page.goto('/');

  // Wait for redirect to Auth0 login page
  await page.waitForURL(/auth0\.com/, { timeout: 30_000 });

  // Fill in credentials from environment variables
  const email = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_USERNAME and E2E_PASSWORD environment variables must be set to run auth setup.\n' +
      'Example: E2E_USERNAME=user@example.com E2E_PASSWORD=secret npx playwright test --project=setup'
    );
  }

  await page.locator('input[name="username"], input[type="email"]').fill(email);
  await page.locator('input[name="password"], input[type="password"]').fill(password);
  await page.locator('button[type="submit"], button[name="action"]').click();

  // Wait until redirected back to the app and dashboard loads
  await page.waitForURL('http://localhost:4200/**', { timeout: 30_000 });
  await expect(page.locator('app-root')).toBeVisible({ timeout: 15_000 });

  // Save storage state (includes Auth0 tokens in localStorage)
  await page.context().storageState({ path: authFile });
});
