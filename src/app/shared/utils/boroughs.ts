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

/**
 * The boroughs accepted right now.
 *
 * Tower Hamlets is gated on the `tower-hamlets-borough-support` flag. Note the gate only
 * bites on the streamlined in-app ward lookup: the legacy iframe lookup cannot resolve a
 * Tower Hamlets postcode at any setting, because its own borough list and boundary data
 * cover Lambeth and Southwark only. So with the legacy lookup selected, Tower Hamlets is
 * unsupported however this flag is set. That gap is known and accepted — see issue #177.
 */
export function supportedBoroughs(towerHamletsEnabled: boolean): Borough[] {
  return towerHamletsEnabled ? [...CORE_BOROUGHS, TOWER_HAMLETS] : [...CORE_BOROUGHS];
}

/**
 * Renders a borough list the way the public copy reads it: "Lambeth and Southwark",
 * "Lambeth, Southwark and Tower Hamlets". Deliberately no Oxford comma — matches the
 * wording signed off in the design.
 */
export function boroughListSentence(boroughs: readonly Borough[]): string {
  const names = boroughs.map((b) => b.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
