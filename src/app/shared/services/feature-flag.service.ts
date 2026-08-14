import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { ConfigService } from './config.service';
// Imported from the module rather than the shared barrel: the barrel eagerly pulls in
// lodash and date-fns, and this service is loaded by the public request page.
import { Borough, supportedBoroughs as boroughsFor } from '../utils/boroughs';

export const DELIVERY_BOOKING_FLAG = 'delivery-booking';

/**
 * Update Scanner (bench scanning page). Unlike delivery-booking this flag
 * WIDENS access rather than switching the feature on: off → the page is
 * reachable only by `app:bulkedit` holders; on → any authenticated staff
 * member. See update-scanner-visible.guard.ts.
 */
export const UPDATE_SCANNER_FLAG = 'update-scanner';

/**
 * Which ward-lookup implementation the public device request page uses. Unlike the flags
 * above this is not a feature hide but a two-way substitution between two working steps:
 * off → the legacy iframe onto communitytechaid.github.io, on → the streamlined
 * postcode-first step built into the page. Either can be selected at any time, in either
 * direction, with no deploy.
 *
 * Off is today's behaviour, so it is both the default and the safe failure mode: when the
 * flags cannot be read at all (see the catchError below) every flag reads false and the
 * page behaves exactly as it does now.
 */
export const STREAMLINED_WARD_LOOKUP_FLAG = 'streamlined-ward-lookup';

/**
 * Whether Tower Hamlets is accepted as a referral area. Off → Lambeth and Southwark only.
 *
 * Only meaningful while STREAMLINED_WARD_LOOKUP_FLAG is on: the legacy lookup cannot
 * resolve a Tower Hamlets postcode at any setting, so selecting it un-supports the borough
 * regardless of this flag. Known and accepted — see issue #177.
 */
export const TOWER_HAMLETS_BOROUGH_FLAG = 'tower-hamlets-borough-support';

const PUBLIC_FLAGS_QUERY = `query FeatureFlagsPublic { featureFlagsPublic { key enabled } }`;

export interface DeliveryBookingVisibility {
  /** Whether the booking pages/links should be shown at all in this environment. */
  visible: boolean;
  /** Whether the feature is "live" (flag on). When false, a UAT-only banner is shown. */
  live: boolean;
}

/**
 * Reads server feature flags. Uses a plain HttpClient GraphQL POST against the public
 * `featureFlagsPublic` query (no auth header) so it works for anonymous visitors on the
 * public booking page as well as logged-in staff — deliberately not the shared Apollo
 * client, whose auth link would bounce an anonymous visitor to Auth0.
 *
 * Visibility rule: the delivery-booking pages show on non-production (UAT/dev) by
 * default; on production they appear only once the `delivery-booking` flag is switched
 * on from the Feature Flags admin page.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  private publicFlags$?: Observable<Record<string, boolean>>;

  constructor(
    private readonly http: HttpClient,
    private readonly config: ConfigService,
  ) {}

  get isProduction(): boolean {
    return !!this.config.environment.production;
  }

  /** Cached load of the public feature flags. Call reload() after an admin toggle. */
  private loadPublicFlags(): Observable<Record<string, boolean>> {
    if (!this.publicFlags$) {
      this.publicFlags$ = this.http
        .post<{ data?: { featureFlagsPublic: { key: string; enabled: boolean }[] } }>(
          this.config.environment.graphql_endpoint,
          { query: PUBLIC_FLAGS_QUERY },
        )
        .pipe(
          map((res) => {
            const flags: Record<string, boolean> = {};
            (res.data?.featureFlagsPublic ?? []).forEach((f) => (flags[f.key] = f.enabled));
            return flags;
          }),
          catchError(() => of({} as Record<string, boolean>)),
          shareReplay(1),
        );
    }
    return this.publicFlags$;
  }

  /** Drop the cache so the next read re-fetches (e.g. after toggling a flag). */
  reload(): void {
    this.publicFlags$ = undefined;
  }

  isEnabled(key: string): Observable<boolean> {
    return this.loadPublicFlags().pipe(map((flags) => !!flags[key]));
  }

  /**
   * The boroughs currently accepted for device referrals, per the Tower Hamlets flag.
   *
   * The one place anything should ask "which boroughs do we support?" — the ward lookup,
   * the borough × device-type admin config and the device request list filter all read
   * this rather than keeping their own list.
   *
   * Reads both flags, because Tower Hamlets needs both: the legacy ward lookup has no
   * Tower Hamlets data, so selecting it un-supports the borough whatever the borough flag
   * says. supportedBoroughs() in shared/utils/boroughs.ts holds that rule.
   */
  supportedBoroughs(): Observable<Borough[]> {
    return this.loadPublicFlags().pipe(
      map((flags) =>
        boroughsFor({
          towerHamlets: !!flags[TOWER_HAMLETS_BOROUGH_FLAG],
          streamlinedLookup: !!flags[STREAMLINED_WARD_LOOKUP_FLAG],
        }),
      ),
    );
  }

  deliveryBookingVisibility(): Observable<DeliveryBookingVisibility> {
    return this.loadPublicFlags().pipe(
      map((flags) => {
        const live = !!flags[DELIVERY_BOOKING_FLAG];
        return { live, visible: !this.isProduction || live };
      }),
    );
  }
}
