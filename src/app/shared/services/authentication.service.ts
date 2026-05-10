import { Injectable } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { LoginUser } from '@app/state/user/actions/user.actions';

/**
 * Thin facade over @auth0/auth0-angular AuthService that preserves the
 * original AuthenticationService API so existing consumers (auth.guard,
 * user.state, graphql.module) need no changes.
 *
 * Previously a hand-rolled wrapper around @auth0/auth0-spa-js v1.
 * The SDK now handles the redirect callback and token caching automatically.
 */
@Injectable({
  providedIn: 'root'
})
export class AuthenticationService {
  isAuthenticated$: Observable<boolean> = this.authService.isAuthenticated$;
  isLoading$: Observable<boolean> = this.authService.isLoading$;
  userProfile$: Observable<any> = this.authService.user$;
  loggedIn: boolean = null;

  constructor(
    private authService: AuthService,
    private router: Router,
    private store: Store,
  ) {
    this.authService.isAuthenticated$.subscribe(loggedIn => {
      this.loggedIn = loggedIn;
      if (loggedIn) {
        this.store.dispatch(new LoginUser());
      }
    });
  }

  getUser$(options?: any): Observable<any> {
    return this.authService.user$;
  }

  getTokenSilently$(options?: any): Observable<string> {
    // Audience is configured globally in AuthModule.forRoot(); no per-call params needed.
    return this.authService.getAccessTokenSilently();
  }

  login(redirectPath: string = '/') {
    this.authService.loginWithRedirect({
      appState: { target: redirectPath }
    });
  }

  logout() {
    this.authService.logout({
      logoutParams: { returnTo: window.location.origin }
    });
  }
}
