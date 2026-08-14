/**
 * The London boroughs Community TechAid accepts device referrals from.
 *
 * Single source of truth. Before this file the list existed as prose in three Formly
 * templates on the public request page and as a hardcoded array in the github.io ward
 * lookup, so "add a borough" meant finding every copy of the sentence. Anything that
 * needs to know which boroughs are supported — the ward lookup, the borough x device-type
 * admin config, the device request list filter — reads it from here.
 *
 * ONS codes are carried alongside the names because they are the stable key: names get
 * re-spelled between boundary vintages, codes do not. The postcode -> borough/ward build
 * step filters ONSPD by these codes rather than by name.
 *
 * `name` is spelled exactly as ONS spells it (`LAD__NM`), which is also the form stored in
 * `device_requests.borough`. Do not "tidy" these strings — they are matched against data.
 */
export interface Borough {
  /** ONS name, and the value persisted on the device request. */
  name: string;
  /** ONS local authority district code. */
  code: string;
}

export const LAMBETH: Borough = { name: 'Lambeth', code: 'E09000022' };
export const SOUTHWARK: Borough = { name: 'Southwark', code: 'E09000028' };
export const TOWER_HAMLETS: Borough = { name: 'Tower Hamlets', code: 'E09000030' };

/**
 * Supported since long before the Tower Hamlets pilot, and not gated on anything. If this
 * ever becomes empty the service has stopped taking referrals entirely, which is not a
 * state any flag should be able to produce.
 */
export const CORE_BOROUGHS: readonly Borough[] = [LAMBETH, SOUTHWARK];

/**
 * Every borough the codebase knows about, whether currently accepted or not. Use this for
 * things that must enumerate boroughs regardless of the pilot's state — an admin filter
 * that has to match historical records, for instance.
 */
export const ALL_BOROUGHS: readonly Borough[] = [LAMBETH, SOUTHWARK, TOWER_HAMLETS];

/** The flag state the supported-borough list is derived from. */
export interface BoroughSupportFlags {
  /** `tower-hamlets-borough-support` — do we accept Tower Hamlets referrals at all? */
  towerHamlets: boolean;
  /** `streamlined-ward-lookup` — is the in-app postcode step selected over the iframe? */
  streamlinedLookup: boolean;
}

/**
 * The boroughs accepted right now — the effective set, not the intended one.
 *
 * Tower Hamlets needs BOTH flags. The borough flag is the intent, but the legacy iframe
 * lookup cannot resolve a Tower Hamlets postcode at any setting: its borough list and its
 * boundary data (in the communitytechaid.github.io repo) cover Lambeth and Southwark only.
 * So while the legacy lookup is selected, Tower Hamlets is unsupported in practice however
 * the borough flag is set.
 *
 * That gap is known and accepted (issue #177). It is encoded here, once, rather than left
 * as prose for each caller to remember — a caller that asks this function what we support
 * gets the truth, including the awkward case where the two flags disagree.
 */
export function supportedBoroughs(flags: BoroughSupportFlags): Borough[] {
  const towerHamletsUsable = flags.towerHamlets && flags.streamlinedLookup;
  return towerHamletsUsable ? [...CORE_BOROUGHS, TOWER_HAMLETS] : [...CORE_BOROUGHS];
}

/**
 * Renders a borough list as public copy reads it: "Lambeth and Southwark", or with
 * `conjunction: 'or'`, "Lambeth, Southwark or Tower Hamlets".
 *
 * The conjunction is a parameter because the two places this appears are not parallel
 * sentences — the out-of-area copy reads "…who live in Lambeth or Southwark", the covered
 * copy reads "…Lambeth and Southwark". Deliberately no Oxford comma, matching the signed-off
 * wording.
 */
export function boroughListSentence(
  boroughs: readonly Borough[],
  conjunction: 'and' | 'or' = 'and',
): string {
  const names = boroughs.map((b) => b.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
}
