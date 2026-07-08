import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Blocks the public delivery-booking route where it shouldn't be reachable: on
 * production while the delivery-booking flag is off. On UAT/dev (or once the flag is on)
 * it lets the page through. Anonymous callers are fine — the flag is read publicly.
 */
export const deliveryBookingVisibleGuard: CanActivateFn = () => {
  const flags = inject(FeatureFlagService);
  const router = inject(Router);
  return flags.deliveryBookingVisibility().pipe(
    map((state) => (state.visible ? true : router.parseUrl('/404'))),
  );
};
