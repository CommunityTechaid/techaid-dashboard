import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, take } from 'rxjs';
import { AuthenticationService } from './authentication.service';

/**
 * Route guard: lets the route through only if the access token carries `permission`;
 * otherwise sends the user to /dashboard (the same landing as updateScannerVisibleGuard).
 * Pair it AFTER AuthGuard — `canActivate: [AuthGuard, requirePermission('read:content')]` —
 * guards run in order, and this one assumes a signed-in user.
 *
 * Permissions are read from the access token rather than NGXS `UserState` for the reason
 * documented in update-scanner-visible.guard.ts: UserState fills `authorities` in a late async
 * patch, so a one-shot guard read could intermittently see an empty map. An unreadable token
 * degrades to "no permissions".
 *
 * This is a UX gate only (no useless page plus error toast); the server's @PreAuthorize is the
 * real enforcement.
 */
export function requirePermission(permission: string): CanActivateFn {
  return () => {
    const auth = inject(AuthenticationService);
    const router = inject(Router);
    return auth.getTokenSilently$().pipe(
      take(1),
      map(token => permissionsFromToken(token).includes(permission)),
      catchError(() => of(false)),
      map(allowed => allowed || router.parseUrl('/dashboard')),
    );
  };
}

/** Read the `permissions` claim out of a JWT payload, mirroring user.state.ts. */
function permissionsFromToken(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Array.isArray(payload?.permissions) ? payload.permissions : [];
  } catch {
    return [];
  }
}
