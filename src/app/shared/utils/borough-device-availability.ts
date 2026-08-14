import { Borough, TOWER_HAMLETS } from './boroughs';

/**
 * Which device types each borough can currently offer.
 *
 * TEMPORARY, AND DELIBERATELY SO. Issue #178 asks for borough-scoped availability to read from
 * config "if the API supports it; otherwise leave a single well-named constant for it and flag
 * it". The API does not support it yet — the borough x device-type admin screen and the records
 * behind it are issue #179. This constant is that single well-named place, and it is the ONLY
 * thing that needs to change when #179 lands: replace the lookup in `devicesAvailableIn()` with
 * the resolved list the public endpoint returns, and delete the map.
 *
 * Do not spread borough-conditional logic anywhere else in the request flow. The whole point of
 * the shape below is that #179 can delete it in one edit.
 *
 * A borough that is absent from the map has no restriction — every device type the admin config
 * currently allows is offered. That is the state Lambeth and Southwark are in, and it is what
 * makes this change a no-op for them.
 */
const RESTRICTED_TO: ReadonlyMap<string, readonly string[]> = new Map([
  // The Tower Hamlets pilot opens with laptops only. Values are the `value` keys used by the
  // deviceRequestItems options in org-request.ts — 'laptops', 'desktops', 'tablets', 'phones',
  // 'commsDevices', 'broadbandHubs'.
  [TOWER_HAMLETS.name, ['laptops'] as readonly string[]],
]);

/**
 * Narrow a list of offered device-type option values to those available in a borough.
 *
 * `offered` is what the admin config already permits; this only ever removes from it, never
 * adds. A borough cannot switch a device type on that the charity has globally switched off.
 */
export function devicesAvailableIn<T extends { value: string }>(
  borough: Borough | string | null | undefined,
  offered: readonly T[],
): T[] {
  const name = typeof borough === 'string' ? borough : borough?.name;
  const allowed = name ? RESTRICTED_TO.get(name) : undefined;
  if (!allowed) return [...offered];
  return offered.filter((option) => allowed.includes(option.value));
}

/** Whether a borough has any restriction at all — i.e. whether to show the availability note. */
export function hasDeviceRestriction(borough: Borough | string | null | undefined): boolean {
  const name = typeof borough === 'string' ? borough : borough?.name;
  return !!name && RESTRICTED_TO.has(name);
}

/**
 * The amber note shown under the device-type list when a borough is restricted, e.g.
 * "In Tower Hamlets we can currently offer laptops only."
 *
 * Copy note: the design file draws this state (2c) with a different sentence — "Smartphones are
 * available in Lambeth thanks to a recent donation…" — which describes a temporary *widening*,
 * not a restriction, and reads wrong for a pilot that is narrower than normal. The wording below
 * follows the copy pattern given in issue #178 instead. Flagged in the PR.
 */
export function deviceRestrictionNote(
  borough: Borough | string | null | undefined,
  offered: readonly { value: string; label: string }[],
): string | null {
  const name = typeof borough === 'string' ? borough : borough?.name;
  if (!name || !hasDeviceRestriction(name)) return null;

  const available = devicesAvailableIn(name, offered);
  if (!available.length) return null;

  // Short plural nouns rather than the full option labels: the SIM card label is a whole
  // sentence ("SIM card (6 months, 20GB data…)") and reads badly mid-sentence.
  const nouns: Record<string, string> = {
    laptops: 'laptops',
    desktops: 'desktops',
    tablets: 'tablets',
    phones: 'smartphones',
    commsDevices: 'SIM cards',
    broadbandHubs: 'broadband hubs',
  };
  const names = available.map((option) => nouns[option.value] ?? option.label.toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `In ${name} we can currently offer ${list} only.`;
}
