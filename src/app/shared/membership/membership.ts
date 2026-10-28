/**
 * Membership support: tiers, the yearly request allowance and membership contacts.
 *
 * The API contract is techaid-server#311. Until it is live everywhere, every membership
 * field is requested only when the `membership-support` public feature flag is on, so the
 * dashboard can ship ahead of the server without querying fields the schema doesn't have yet.
 * Components therefore keep two query documents (with and without these selections) and pick
 * one per request from the flag.
 */

export const MEMBERSHIP_FLAG = 'membership-support';

export type MembershipTier = 'FREE' | 'TIER_1' | 'TIER_2' | 'TIER_3';
export type MembershipState = 'OK' | 'LAST_REQUEST' | 'LIMIT_REACHED';
export type MembershipOverLimitMode = 'GRACE' | 'BLOCK';

/** Staff-facing allowance for an organisation (`ReferringOrganisation.membership`). */
export interface Membership {
  tier: MembershipTier;
  periodStart: string;
  periodEnd: string;
  /** null for TIER_3, which is uncapped. */
  cap: number | null;
  used: number;
  remaining: number | null;
  state: MembershipState;
  graceUsed: number;
  /** A paid membership has lapsed; `tier` is then the effective tier (FREE). */
  expired: boolean;
  lapsedTier: MembershipTier | null;
  lapsedOn: string | null;
}

/** Anonymous allowance on the public form (`ReferringOrganisationContactPublic.membershipAllowance`). */
export interface MembershipPublic {
  tier: MembershipTier;
  state: MembershipState;
  cap: number | null;
  used: number;
  remaining: number | null;
  periodEnd: string;
  graceUsed: number;
  graceRemaining: number;
  expired: boolean;
}

/** Selection set for `Membership` — interpolate into a gql document. */
export const MEMBERSHIP_SELECTION = `membership { tier periodStart periodEnd cap used remaining state graceUsed expired lapsedTier lapsedOn }`;

/** Selection set for `MembershipPublic`. */
export const MEMBERSHIP_PUBLIC_SELECTION =
  `membershipAllowance { tier state cap used remaining periodEnd graceUsed graceRemaining expired }`;

export const MEMBERSHIP_TIERS: { value: MembershipTier; label: string; range: string; fee: string }[] = [
  { value: 'FREE', label: 'Free', range: '1–10 requests a year', fee: 'Free' },
  { value: 'TIER_1', label: 'Tier 1', range: '11–20 requests a year', fee: '£175' },
  { value: 'TIER_2', label: 'Tier 2', range: '21–40 requests a year', fee: '£300' },
  { value: 'TIER_3', label: 'Tier 3', range: '41+ requests a year', fee: '£750' },
];

export function tierLabel(tier: MembershipTier | null | undefined): string {
  return MEMBERSHIP_TIERS.find(t => t.value === tier)?.label ?? 'Free';
}

/**
 * The read-only end of a membership year: start + 1 year − 1 day. The server computes the
 * real value; this only previews it while staff edit the start date, before saving.
 * Works on plain `YYYY-MM-DD` strings so no timezone can shift the day.
 */
export function membershipPeriodEnd(start: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start || '');
  if (!m) {
    return '';
  }
  const d = new Date(Date.UTC(+m[1] + 1, +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Marker the server puts on a `createDeviceRequest` refused for the membership allowance —
 * the message prefix and `extensions.code` requested on techaid-server#311. Distinct from the
 * per-referee open-request cap, which org-request detects by its own wording.
 */
export const MEMBERSHIP_LIMIT_MARKERS = ['Membership allowance reached', 'MEMBERSHIP_LIMIT_REACHED'];

/** Which request-form notice an allowance calls for. */
export type MembershipNotice = 'last' | 'grace' | 'block' | null;

/**
 * Decides the request-form notice from the server's allowance and over-limit mode.
 *
 * The mode is server config (`adminConfig.membershipOverLimitMode`), never assumed here: with
 * no mode known, an organisation at its limit gets no pre-emptive notice and the server's own
 * answer to the submit decides. TIER_3 is uncapped, so the server never reports it as anything
 * but OK.
 */
export function membershipNotice(
  allowance: Pick<MembershipPublic, 'state' | 'graceRemaining'> | null | undefined,
  mode: MembershipOverLimitMode | null | undefined,
): MembershipNotice {
  if (!allowance) {
    return null;
  }
  if (allowance.state === 'LAST_REQUEST') {
    return 'last';
  }
  if (allowance.state !== 'LIMIT_REACHED') {
    return null;
  }
  if (mode === 'GRACE') {
    return (allowance.graceRemaining ?? 0) > 0 ? 'grace' : 'block';
  }
  return mode === 'BLOCK' ? 'block' : null;
}

/** The day the allowance renews: the day after the period ends. */
export function membershipRenewalDate(periodEnd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd || '');
  if (!m) {
    return '';
  }
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return d.toISOString().slice(0, 10);
}

/** Formats a `YYYY-MM-DD` date as e.g. "31 Jan 2027" without going through local time. */
export function formatMembershipDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) {
    return '';
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+m[3]} ${months[+m[2] - 1]} ${m[1]}`;
}
