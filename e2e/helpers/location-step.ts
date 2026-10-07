import { expect, Page } from '@playwright/test';

/**
 * Postcodes verified against the shipped table
 * (src/assets/ward-lookup/postcode-index.may-2026.json). Kept here as well as in
 * streamlined-ward-lookup.spec.ts because a spec that only needs to get PAST the location step
 * should not have to import from the spec that tests it.
 */
export const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark
export const TOWER_HAMLETS_POSTCODE = 'E14 8JH'; // Canary Wharf, Tower Hamlets

export interface AdvanceOptions {
  /** Must exist in the shipped postcode table. */
  postcode?: string;
}

/**
 * Get the public request form past the postcode location step.
 *
 * Kept as a helper so a spec that only needs to get PAST the location step does not have to
 * encode how it works. (The legacy github.io iframe step, and the `streamlined-ward-lookup`
 * flag that selected it, were retired on 2026-10-07; the postcode step is the only one.)
 * Assertions about the location step itself belong in streamlined-ward-lookup.spec.ts.
 */
export async function advancePastLocationStep(
  page: Page,
  options: AdvanceOptions = {},
): Promise<void> {
  const postcode = options.postcode ?? COVERED_POSTCODE;
  const postcodeInput = page.locator('#postcode');
  await expect(postcodeInput).toBeVisible({ timeout: 15_000 });
  await postcodeInput.fill(postcode);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit a request' }).click();
  await expect(postcodeInput).toHaveCount(0);
}
