import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay, timeout } from 'rxjs';
import { ConfigService } from './config.service';

/**
 * What one borough currently offers, as resolved by the server.
 *
 * `offered` is already resolved — the browser is never handed raw ON/OFF/AUTO modes, because
 * resolving AUTO means reading a stock signal only the server could have. See the note on
 * `unresolvedAuto`.
 */
export interface BoroughAvailability {
  borough: string;
  /** Device type keys currently offered, e.g. `['laptops']`. Empty means nothing is on offer. */
  offered: string[];
  /** Requests one referee may have open here. Advisory on the client; the server enforces it. */
  maxPerReferee: number;
  /**
   * Device types an admin set to AUTO, which currently resolve to CLOSED because nothing computes
   * the stock signal AUTO implies. Carried through so the admin screen can show that a selected
   * mode is inert rather than leaving someone wondering why an "open" borough offers nothing.
   */
  unresolvedAuto: string[];
}

const PUBLIC_AVAILABILITY_QUERY = `query BoroughAvailabilityPublic {
  boroughAvailabilityPublic { borough offered maxPerReferee unresolvedAuto }
}`;

/**
 * A hung request is not an error, so catchError would never fire and the public request page
 * would wait forever with no device list and no explanation. Same reasoning, and same value, as
 * the flags request next door.
 */
const AVAILABILITY_REQUEST_TIMEOUT_MS = 20000;

/**
 * Reads which device types each borough currently offers.
 *
 * Deliberately a plain HttpClient POST rather than the shared Apollo client, for the same reason
 * FeatureFlagService is: the public device request form is unauthenticated, and Apollo's auth link
 * would bounce an anonymous visitor to Auth0. `boroughAvailabilityPublic` is readable without a
 * token by design.
 *
 * This is the one read path the availability rule travels on. Before it, the rule lived in a
 * hardcoded constant that the public form and the amber copy string each read separately; issue
 * #179 exists partly to stop that becoming three answers to the same question. The admin screen
 * edits the config, the server resolves it, and this is how everything else finds out — nothing
 * else should encode which boroughs offer what.
 */
@Injectable({ providedIn: 'root' })
export class BoroughAvailabilityService {
  private availability$?: Observable<Record<string, BoroughAvailability>>;

  constructor(
    private readonly http: HttpClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cached per page load, keyed by borough name.
   *
   * On failure this resolves to an EMPTY map, and callers treat "no entry for this borough" as
   * "no restriction recorded" rather than "nothing is available". Failing closed would hide every
   * device type from every referrer the moment this one request failed, which is a far worse
   * outcome than briefly offering a type the pilot cannot supply.
   */
  private load(): Observable<Record<string, BoroughAvailability>> {
    if (!this.availability$) {
      this.availability$ = this.http
        .post<{ data?: { boroughAvailabilityPublic: BoroughAvailability[] } }>(
          this.config.environment.graphql_endpoint,
          { query: PUBLIC_AVAILABILITY_QUERY },
        )
        .pipe(
          timeout(AVAILABILITY_REQUEST_TIMEOUT_MS),
          map((res) => {
            const byBorough: Record<string, BoroughAvailability> = {};
            (res.data?.boroughAvailabilityPublic ?? []).forEach((row) => {
              byBorough[normalise(row.borough)] = row;
            });
            return byBorough;
          }),
          catchError(() => of({} as Record<string, BoroughAvailability>)),
          shareReplay(1),
        );
    }
    return this.availability$;
  }

  /** Drop the cache so the next read re-fetches — call after an admin save. */
  reload(): void {
    this.availability$ = undefined;
  }

  /** Everything the server knows, keyed by normalised borough name. */
  all(): Observable<Record<string, BoroughAvailability>> {
    return this.load();
  }

  /** The record for one borough, or null if the server has no configuration for it. */
  forBorough(borough: string | null | undefined): Observable<BoroughAvailability | null> {
    return this.load().pipe(map((all) => (borough ? (all[normalise(borough)] ?? null) : null)));
  }
}

/**
 * Borough names have arrived from the old iframe lookup, the new postcode table and hand entry
 * over the years, so match on a case- and whitespace-insensitive form. The server does the same
 * when it resolves a request's borough to a group; a capitalisation difference must not silently
 * mean "no configuration".
 */
function normalise(borough: string): string {
  return (borough || '').trim().toLowerCase();
}

/**
 * Narrow a list of offered device-type options to those available in a borough.
 *
 * `offered` is what the global admin config already permits; this only ever removes from it. A
 * borough cannot switch on a device type the charity has switched off everywhere, so the two
 * controls compose in one direction only and there is no way for borough config to widen the offer.
 *
 * `availability` of null means the server has no record for this borough — treated as no
 * restriction, per the fail-open reasoning on load().
 */
export function narrowToAvailability<T extends { value: string }>(
  availability: BoroughAvailability | null,
  offered: readonly T[],
): T[] {
  if (!availability) return [...offered];
  return offered.filter((option) => availability.offered.includes(option.value));
}

/**
 * The amber note shown under the device-type list when a borough offers less than usual, e.g.
 * "In Tower Hamlets we can currently offer laptops only." Returns null when nothing is narrowed.
 *
 * Generated from the config rather than written beside it — the copy and the filtering must not be
 * able to disagree, which is exactly what happens when a sentence naming device types is
 * maintained by hand next to the list that actually decides them.
 *
 * Copy note: design 2c draws this state with a different sentence ("Smartphones are available in
 * Lambeth thanks to a recent donation…"), which describes a temporary *widening* and reads wrong
 * for a pilot that is narrower than normal. The wording below follows the pattern in issue #178.
 */
export function availabilityNote(
  borough: string | null | undefined,
  availability: BoroughAvailability | null,
  offered: readonly { value: string; label: string }[],
): string | null {
  if (!borough || !availability) return null;

  const available = narrowToAvailability(availability, offered);

  // A borough configured with everything closed is a real state — a paused pilot, or no stock.
  // It must say so: without this the device list simply renders empty with no explanation, which
  // issue #179 calls out by name as the failure mode to avoid.
  if (available.length === 0) {
    return `We can't currently offer any devices in ${borough}. Please check back later, or email us to discuss further.`;
  }

  if (available.length === offered.length) return null;

  // Short plural nouns rather than the full option labels: the SIM card label is a whole sentence
  // ("SIM card (6 months, 20GB data…)") and reads badly mid-sentence.
  const nouns: Record<string, string> = {
    laptops: 'laptops',
    desktops: 'desktops',
    tablets: 'tablets',
    phones: 'smartphones',
    allInOnes: 'all-in-ones',
    commsDevices: 'SIM cards',
    broadbandHubs: 'broadband hubs',
    other: 'other devices',
  };
  const names = available.map((option) => nouns[option.value] ?? option.label.toLowerCase());
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `In ${borough} we can currently offer ${list} only.`;
}
