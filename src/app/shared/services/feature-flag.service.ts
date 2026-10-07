import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay, timeout } from 'rxjs';
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
 * Whether Tower Hamlets is accepted as a referral area. Off → Lambeth and Southwark only.
 */
export const TOWER_HAMLETS_BOROUGH_FLAG = 'tower-hamlets-borough-support';

const PUBLIC_FLAGS_QUERY = `query FeatureFlagsPublic { featureFlagsPublic { key enabled } }`;

/**
 * How long to wait for the flags before giving up and treating every flag as off.
 *
 * Generous, because callers that need the backend already wait on their own cold-start check
 * before asking; this is a backstop against a request that never settles at all, not a latency
 * budget.
 */
const FLAG_REQUEST_TIMEOUT_MS = 20000;

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
          // A hung request is not an error, so catchError below would never fire and every
          // caller awaiting a flag would wait forever. On the public request page that means a
          // location step that renders neither implementation and never says why. Bound it, and
          // let the timeout fall through to the same all-flags-false default as any other
          // failure.
          timeout(FLAG_REQUEST_TIMEOUT_MS),
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
   */
  supportedBoroughs(): Observable<Borough[]> {
    return this.loadPublicFlags().pipe(
      map((flags) =>
        boroughsFor({ towerHamlets: !!flags[TOWER_HAMLETS_BOROUGH_FLAG] }),
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
