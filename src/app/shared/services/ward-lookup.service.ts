import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
// Imported from the module rather than the shared barrel: the barrel eagerly pulls in lodash
// and date-fns, and this service is loaded by the public request page. Same reason as
// feature-flag.service.ts.
import { Borough, ALL_BOROUGHS } from '../utils/boroughs';

/**
 * The generated lookup table. Regenerate with:
 *
 *     python tools/ward-lookup/build_postcode_index.py
 *
 * ...then update this constant to the new filename. The vintage lives in the filename AND in
 * the artefact's own `meta` block, so "which edition is live?" is answerable from either the
 * repo or a running build. This constant is the only place in the app that names it — refresh
 * is a one-line change here plus the regenerated file.
 */
export const POSTCODE_INDEX_ASSET = 'assets/ward-lookup/postcode-index.may-2026.json';

/** Shape of the generated artefact. See the builder script for how it is packed. */
interface PostcodeIndex {
  meta: {
    onspdEdition: string;
    wardVintage: string;
    generated: string;
    postcodeCount: number;
    wardCount: number;
    attribution: string[];
  };
  boroughs: { code: string; name: string }[];
  wards: { code: string; name: string; borough: number }[];
  /** outward code -> ward index (as a string key) -> concatenated 3-char inward codes. */
  postcodes: Record<string, Record<string, string>>;
}

export type PostcodeLookup =
  /** Resolved to one of the three boroughs in the table. Whether we *accept* it is a separate
   *  question — see FeatureFlagService.supportedBoroughs(). */
  | { status: 'resolved'; postcode: string; borough: Borough; ward: string; wardCode: string }
  /** Well-formed, but not in the table. Could be out of area, or a postcode newer than our
   *  ONSPD edition. We deliberately cannot tell the difference, and do not guess. */
  | { status: 'not-found'; postcode: string }
  /** Does not look like a UK postcode at all — a typo hint, not an eligibility statement. */
  | { status: 'malformed'; postcode: string }
  /** The table could not be loaded. Distinct from 'not-found': never tell someone we do not
   *  cover them because a fetch failed. */
  | { status: 'unavailable'; postcode: string };

/**
 * A UK postcode, space-stripped and upper-cased. Deliberately the loose-but-structural form
 * rather than the exhaustive Royal Mail pattern: its job is to catch "that isn't a postcode"
 * before we look anything up, not to validate against the real allocation rules. The table
 * itself is the authority on what exists.
 */
const POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/** Every inward code is exactly three characters (digit, letter, letter). The packing relies
 *  on it, so the scan below can step in threes rather than storing separators. */
const INWARD_LENGTH = 3;

/**
 * Resolves a UK postcode to the borough and ward it sits in.
 *
 * This replaces a browser-side pipeline that geocoded the postcode through a Cloudflare worker,
 * downloaded a 3.3 MB GeoJSON of ward boundaries, and ran point-in-polygon over every feature.
 * ONS already publishes postcode -> ward as a flat table (the ONS Postcode Directory), so we
 * precompute at build time and ship a 63 KB same-origin asset instead: no geocoder, no geometry
 * library, no third-party runtime call, and no CSP change (`connect-src 'self'` already covers
 * it).
 *
 * The table holds ONLY the three supported boroughs, and only live postcodes. A miss therefore
 * carries no information about where the postcode actually is, which is deliberate — we do not
 * name a borough we cannot stand behind. See issue #178.
 */
@Injectable({ providedIn: 'root' })
export class WardLookupService {
  private index$?: Observable<PostcodeIndex | null>;

  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch the table, once per page load.
   *
   * Nothing touches this until the location step actually renders, which keeps the asset out
   * of the initial page weight — it is an asset fetch, not an import, so it is never in a
   * bundle at all. `null` means the fetch failed; callers surface that as 'unavailable'
   * rather than as "not covered".
   */
  private load(): Observable<PostcodeIndex | null> {
    if (!this.index$) {
      this.index$ = this.http.get<PostcodeIndex>(POSTCODE_INDEX_ASSET).pipe(
        catchError(() => of(null)),
        shareReplay(1),
      );
    }
    return this.index$;
  }

  /** Normalised form: upper-cased, all whitespace removed. */
  static normalise(postcode: string): string {
    return (postcode || '').toUpperCase().replace(/\s+/g, '');
  }

  /** Display form: single space before the three-character inward code. */
  static format(postcode: string): string {
    const pc = WardLookupService.normalise(postcode);
    if (pc.length < 5) return pc;
    return `${pc.slice(0, -INWARD_LENGTH)} ${pc.slice(-INWARD_LENGTH)}`;
  }

  /** Whether a string is structurally a UK postcode. Says nothing about whether it exists. */
  static isWellFormed(postcode: string): boolean {
    return POSTCODE_RE.test(WardLookupService.normalise(postcode));
  }

  /** Metadata about the loaded table — edition, generation date, required attribution. */
  meta(): Observable<PostcodeIndex['meta'] | null> {
    return this.load().pipe(map((index) => index?.meta ?? null));
  }

  lookup(rawPostcode: string): Observable<PostcodeLookup> {
    const postcode = WardLookupService.format(rawPostcode);

    if (!WardLookupService.isWellFormed(rawPostcode)) {
      return of({ status: 'malformed', postcode } as const);
    }

    return this.load().pipe(
      map((index) => {
        if (!index) return { status: 'unavailable', postcode } as const;

        const normalised = WardLookupService.normalise(rawPostcode);
        const outward = normalised.slice(0, -INWARD_LENGTH);
        const inward = normalised.slice(-INWARD_LENGTH);

        const buckets = index.postcodes[outward];
        if (!buckets) return { status: 'not-found', postcode } as const;

        for (const [wardIndex, packed] of Object.entries(buckets)) {
          if (!containsInward(packed, inward)) continue;

          const ward = index.wards[Number(wardIndex)];
          const boroughName = index.boroughs[ward.borough]?.name;
          // Match back to the app's own borough constants rather than trusting the artefact's
          // strings, so everything downstream compares identical objects. The builder filters
          // ONSPD by the same ONS codes, so a miss here means the artefact and boroughs.ts
          // have drifted — treat it as not-found rather than inventing a Borough.
          const borough = ALL_BOROUGHS.find((b) => b.name === boroughName);
          if (!borough) return { status: 'not-found', postcode } as const;

          return {
            status: 'resolved',
            postcode,
            borough,
            ward: ward.name,
            wardCode: ward.code,
          } as const;
        }

        return { status: 'not-found', postcode } as const;
      }),
    );
  }
}

/**
 * Whether a packed bucket contains an inward code.
 *
 * The bucket is inward codes concatenated with no separator, so a naive substring test would
 * match across a boundary — "9GE" + "9GF" packs to "9GE9GF", which contains "E9G" spuriously.
 * Only matches that begin on a three-character boundary are real.
 */
function containsInward(packed: string, inward: string): boolean {
  for (let i = packed.indexOf(inward); i !== -1; i = packed.indexOf(inward, i + 1)) {
    if (i % INWARD_LENGTH === 0) return true;
  }
  return false;
}
