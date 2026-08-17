import { expect, Page } from '@playwright/test';

/**
 * Postcodes verified against the shipped table
 * (src/assets/ward-lookup/postcode-index.may-2026.json). Kept here as well as in
 * streamlined-ward-lookup.spec.ts because a spec that only needs to get PAST the location step
 * should not have to import from the spec that tests it.
 */
export const COVERED_POSTCODE = 'SE15 5TD'; // Peckham, Southwark
export const TOWER_HAMLETS_POSTCODE = 'E14 8JH'; // Canary Wharf, Tower Hamlets

export type LocationStepMode = 'streamlined' | 'legacy';

export interface AdvanceOptions {
  /** Used by the streamlined step. Must exist in the shipped postcode table. */
  postcode?: string;
  /** Used by the legacy iframe, which reports a resolved borough/ward rather than a postcode. */
  borough?: string;
  ward?: string;
}

/**
 * Get the public request form past whichever location step is currently live, and say which one
 * it was.
 *
 * WHY THIS EXISTS
 *   The location step is chosen by the `streamlined-ward-lookup` feature flag, which on UAT is a
 *   database row that anyone can flip between runs. A spec that is not ABOUT the location step
 *   therefore cannot know which one it will meet, and must not assert either.
 *
 *   bugs.spec.ts learned this the hard way: its ORG-B2 test faked the legacy iframe's postMessage
 *   to skip ahead, and when `streamlined-ward-lookup` was switched on in UAT (2026-08-17) there
 *   was no iframe listening. The form never advanced and the test failed ten seconds later on a
 *   radio button, which said nothing about the real cause.
 *
 *   Pinning the other mode would not have fixed it — it would have moved the same breakage to the
 *   next time the flag went off. The only stable answer for an incidental step is to handle both.
 *
 * WHERE MODE-SPECIFIC ASSERTIONS BELONG
 *   streamlined-ward-lookup.spec.ts. It mocks the flag, owns both paths, and tests each
 *   deliberately. Nothing else should encode which lookup is live.
 */
export async function advancePastLocationStep(
  page: Page,
  options: AdvanceOptions = {},
): Promise<LocationStepMode> {
  const postcode = options.postcode ?? COVERED_POSTCODE;
  const borough = options.borough ?? 'Lambeth';
  const ward = options.ward ?? 'Brixton Hill';

  // The streamlined step renders a real input; the legacy one is an iframe with no DOM we can
  // reach. Presence of #postcode is therefore the discriminator, and it is the flag's only
  // observable effect from out here.
  const postcodeInput = page.locator('#postcode');
  if (await postcodeInput.count() > 0) {
    await expect(postcodeInput).toBeVisible({ timeout: 15_000 });
    await postcodeInput.fill(postcode);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('postcode-covered')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: "That's right" }).click();
    await expect(postcodeInput).toHaveCount(0);
    return 'streamlined';
  }

  // Legacy: the component only learns the borough from a postMessage on the github.io origin,
  // so faking that message is the sole way in.
  await page.evaluate(
    ({ borough: b, ward: w }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://communitytechaid.github.io',
          data: { borough: b, ward: w },
        }),
      );
    },
    { borough, ward },
  );

  // The legacy path has no positive signal of its own — the iframe simply goes away — so confirm
  // the form behind it actually appeared rather than returning a success we have not checked.
  await expect(page.locator('formly-form').first()).toBeVisible({ timeout: 15_000 });
  return 'legacy';
}
