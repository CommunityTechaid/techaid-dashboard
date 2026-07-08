import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { ConfigService } from './config.service';

export const DELIVERY_BOOKING_FLAG = 'delivery-booking';

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

  deliveryBookingVisibility(): Observable<DeliveryBookingVisibility> {
    return this.loadPublicFlags().pipe(
      map((flags) => {
        const live = !!flags[DELIVERY_BOOKING_FLAG];
        return { live, visible: !this.isProduction || live };
      }),
    );
  }
}
