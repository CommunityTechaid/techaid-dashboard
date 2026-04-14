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
    // Wait for the SDK to finish loading the cached session before checking auth state.
    // Without this, isAuthenticated$ emits false synchronously on the first navigation
    // (before localStorage has been read) and the guard immediately redirects to Auth0.
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
