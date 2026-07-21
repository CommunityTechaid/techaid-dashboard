import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, combineLatest, map, of, take } from 'rxjs';
import { AuthenticationService } from '@app/shared/services/authentication.service';
import { FeatureFlagService, UPDATE_SCANNER_FLAG } from '@app/shared/services/feature-flag.service';

/** Authority that has always been allowed to change device statuses in bulk. */
const BULK_EDIT_AUTHORITY = 'app:bulkedit';

/**
 * Gates the Update Scanner. The rule is `flagOn || hasAuthority('app:bulkedit')`:
 * the `update-scanner` server flag WIDENS access to all authenticated staff,
 * it does not switch the feature on. With the flag off — the normal state — the
 * page stays reachable for the same people who can already bulk-change statuses.
 *
 * ⚠️ Deliberately NOT shaped like `prepModeEnabledGuard`, which redirects
 * *everyone* when its flag is off. Copying that here would invert the intent.
 *
 * Permissions come from the access token rather than NGXS `UserState`, because
 * `UserState` populates `authorities` in a *third* async patch (login → profile
 * → token parse, see user.state.ts `handleLoggedIn`); a one-shot guard read
 * races it and would intermittently see an empty authority map. The token is a
 * single deterministic emission of the same claim `UserState` itself parses.
 * The Devices-page entry button is reactive and re-renders on every emission,
 * so it uses `UserState` as usual.
 */
export const updateScannerVisibleGuard: CanActivateFn = () => {
  const flags = inject(FeatureFlagService);
  const auth = inject(AuthenticationService);
  const router = inject(Router);

  // Neither read may hard-fail the navigation: an unreadable flag degrades to
  // "off" so the authority check still admits its holders, and an unreadable
  // token degrades to "no permissions" so the flag can still admit everyone.
  const flagOn$ = flags.isEnabled(UPDATE_SCANNER_FLAG).pipe(take(1), catchError(() => of(false)));
  const permissions$ = auth.getTokenSilently$().pipe(
    take(1),
    map(permissionsFromToken),
    catchError(() => of([] as string[])),
  );

  return combineLatest([flagOn$, permissions$]).pipe(
    map(([flagOn, permissions]) => flagOn || permissions.includes(BULK_EDIT_AUTHORITY)),
    map(allowed => allowed || router.parseUrl('/dashboard')),
  );
};

/** Read the `permissions` claim out of a JWT payload, mirroring user.state.ts. */
function permissionsFromToken(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Array.isArray(payload?.permissions) ? payload.permissions : [];
  } catch {
    return [];
  }
}
