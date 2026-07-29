import { Provider } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Apollo, APOLLO_OPTIONS } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { ApolloClientOptions, InMemoryCache } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { ServerError } from '@apollo/client/errors';
import { ConfigService } from '@app/shared/services/config.service';
import { AuthenticationService } from './shared/services/authentication.service';
import { firstValueFrom, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, switchMap, take } from 'rxjs/operators';

// Auth0 error codes that mean the session is genuinely gone and the user must log in again
// (as opposed to a transient/network failure, where bouncing them to Auth0 would be wrong).
const REAUTH_ERROR_CODES = ['login_required', 'consent_required', 'missing_refresh_token'];

const isReauthError = (err: any) => Boolean(err) && REAUTH_ERROR_CODES.includes(err.error);

// A transient token failure is usually a lost race, not a broken session, and the winner of that
// race has by then written a fresh token to the cache — so a retry typically resolves from cache
// immediately rather than going back to the network. Two attempts is plenty; more would just
// delay surfacing a real outage.
const TOKEN_RETRY_COUNT = 2;
const TOKEN_RETRY_DELAY_MS = 250;

export function createApollo(httpLink: HttpLink, config: ConfigService, authService: AuthenticationService): ApolloClientOptions {
  const http = httpLink.create({
    uri: config.environment.graphql_endpoint
  });

  // A burst of failed queries (e.g. several tables loading at once) can each detect the auth
  // failure; guard so only the first triggers the redirect to Auth0 and we never loop.
  let reauthInProgress = false;
  const redirectToLogin = () => {
    if (reauthInProgress) {
      return;
    }
    reauthInProgress = true;
    // Preserve the current route so the user returns here after logging in — same mechanism
    // the AuthGuard uses (login(state.url)).
    authService.login(window.location.pathname + window.location.search);
  };

  // Deciding whether a request may go out unauthenticated requires knowing whether this is a
  // staff session or a genuine anonymous visitor — and that answer is only trustworthy once the
  // Auth0 SDK has finished restoring any cached session.
  //
  // isAuthenticated$ is exactly that signal: auth0-angular gates it on isLoading$ internally, so
  // its first emission is the settled answer. getAccessTokenSilently() notably does NOT wait that
  // way — it calls the client immediately — and that asymmetry is what put queries in the SDK's
  // init window in the first place.
  //
  // Why the init window is dangerous, from the auth0-spa-js source: getTokenSilently() dedupes
  // concurrent calls through singlePromise(), keyed clientId::audience::scope. During init the SDK
  // runs checkSession(), which with useRefreshTokens: true performs its own getTokenSilently()
  // under that same key — and then swallows any failure (`catch (_) {}`) so init completes and the
  // user still looks logged in. A query firing in that window does not start its own fetch; it
  // JOINS checkSession's in-flight promise and inherits its rejection. That is why the first
  // authenticated call of a page load was the one denied while calls a second later succeeded.
  //
  // The rejection itself can be any transient failure — a refresh-token rotation race answering
  // invalid_grant, a 5xx or network blip surfacing as GenericError('request_error'), or a
  // TimeoutError from the getTokenSilently lock. None are in REAUTH_ERROR_CODES, so the old code
  // fell straight through to success({}) and sent the query with no Authorization header: HTTP 200
  // + GraphQL "Access Denied", no redirect, no console error. That is the production signature
  // (~30% of findAll calls daily, and not unique to findAll — findAllKits saw it too).
  //
  // Sequencing the token fetch after isAuthenticated$ keeps queries out of the init window; the
  // branching below removes the silent downgrade if a token fetch fails anyway.
  //
  // This deliberately does NOT read authService.loggedIn. That field is assigned from a separate
  // isAuthenticated$ subscription in AuthenticationService's constructor, and emission order
  // between two subscribers of the same observable is not guaranteed — so on a cold load it can
  // still be null here and misclassify a staff user as anonymous. Taking the value from the
  // stream we are already sequenced on has no such window.
  const asyncAuthLink = setContext((_request, _previous) => firstValueFrom(
    authService.isAuthenticated$.pipe(
      take(1),
      switchMap(isAuthenticated =>
        authService.getTokenSilently$({ audience: config.environment.auth_audience }).pipe(
          // Retry transient failures only. A genuine re-auth error is definitive: retrying it
          // just delays the redirect, and for an anonymous visitor (who always gets one of
          // these) it would delay the public form for no reason.
          retry({
            count: TOKEN_RETRY_COUNT,
            delay: (err) => (isReauthError(err) ? throwError(() => err) : timer(TOKEN_RETRY_DELAY_MS)),
          }),
          map(token => ({ headers: new HttpHeaders({ 'Authorization': `Bearer ${token}` }) })),
          catchError(err => {
            if (!isAuthenticated) {
              // A genuine anonymous visitor on a public route such as
              // /organisation-device-request. Auth0 rejects identically for "never had a
              // session" and "session expired", so this branch is the only thing separating
              // them. The request must still go out — unauthenticated — because the public
              // resolvers accept it. Removing this is the 2026-07-28 production incident, where
              // every anonymous visitor was bounced to Auth0 login and nobody could submit a
              // device request. Pinned by anon-public-request-no-login-redirect.spec.ts and by
              // the anonymous half of auth-link-no-anonymous-downgrade.spec.ts.
              return of({});
            }

            // From here on the user is known to be authenticated, so an unauthenticated request
            // would be strictly wrong: the API would answer "Access Denied" and the UI would
            // show empty tables with no explanation.
            if (isReauthError(err)) {
              // Session genuinely gone mid-use — re-prompt.
              redirectToLogin();
            }
            // Fail the request instead of downgrading it. The error surfaces to the caller (and
            // is visible in the console) rather than being laundered into a silent server-side
            // denial. errorHandler below ignores it: it has no 401 status, so no login loop.
            return throwError(() => err);
          }),
        ),
      ),
    ),
  ));

  const errorHandler = onError(({ error }) => {
    // A 401 from the API means the token is missing/expired → prompt re-login. A GraphQL-level
    // "Access Denied" (HTTP 200, surfaced as a CombinedGraphQLErrors with no statusCode) is
    // deliberately left alone: it can be a genuine permission denial for an authenticated user,
    // and redirecting on it would cause a login loop.
    const status = ServerError.is(error)
      ? error.statusCode
      : ((error as any)?.statusCode ?? (error as any)?.status);
    if (status === 401) {
      redirectToLogin();
    }
  });

  return {
    link: errorHandler.concat(asyncAuthLink.concat(http)),
    cache: new InMemoryCache(),
  };
}

export const graphqlProviders: Provider[] = [
  Apollo,
  {
    provide: APOLLO_OPTIONS,
    useFactory: createApollo,
    deps: [HttpLink, ConfigService, AuthenticationService],
  },
];
