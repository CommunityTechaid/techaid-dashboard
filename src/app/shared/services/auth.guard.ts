import { Injectable } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthenticationService } from './authentication.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AuthGuard  {

  constructor(private auth: AuthenticationService , private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean|UrlTree> | boolean {
    return this.auth.isAuthenticated$.pipe(
      tap(loggedIn => {
        if (!loggedIn) {
          this.auth.login(state.url);
        }
      })
    );
  }
}
