import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '@auth0/auth0-angular';
import { AuthenticationService } from './authentication.service';
import { Observable } from 'rxjs';
import { filter, switchMap, take, tap } from 'rxjs/operators';

@Injectable()
export class AuthGuard  {

  constructor(
    private auth: AuthenticationService,
    private authService: AuthService,
    private router: Router,
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean|UrlTree> | boolean {
    // The isLoading$ gate below is a NO-OP and is kept only because it is harmless.
    //
    // It was written for the hand-rolled @auth0/auth0-spa-js v1 wrapper this service replaced
    // (see authentication.service.ts), where isAuthenticated$ really did emit false
    // synchronously before localStorage had been read, bouncing first navigations to Auth0.
    // @auth0/auth0-angular v2 derives isAuthenticated$ from isLoading$ itself —
    // `isAuthenticatedTrigger$ = isLoading$.pipe(filter(loading => !loading), …)` in
    // auth.state.ts, whose docstring says "there is no need to manually check the loading
    // state of the SDK". Auth0's own bundled AuthGuard samples isAuthenticated$ directly.
    // Verified 2026-07-22: deleting this gate changes no observable behaviour.
    //
    // Do NOT copy this pattern into new code as though the race were real — it is not.
    //
    // NB this guard runs on every login callback: main.ts sets redirect_uri to the origin, so
    // Auth0 returns every user to '/', which is guarded. That path is covered by
    // e2e/tests/login-callback-guarded-root.spec.ts, which fails if it ever starts looping.
    return this.authService.isLoading$.pipe(
      filter(isLoading => !isLoading),
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
      tap(loggedIn => {
        if (!loggedIn) {
          this.auth.login(state.url);
        }
      })
    );
  }
}
