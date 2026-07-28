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

// Auth0 error codes that mean the session is genuinely gone and the user must log in again
// (as opposed to a transient/network failure, where bouncing them to Auth0 would be wrong).
const REAUTH_ERROR_CODES = ['login_required', 'consent_required', 'missing_refresh_token'];

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

  const asyncAuthLink = setContext((_request, _previous) => new Promise((success) => {
    authService.getTokenSilently$({ audience: config.environment.auth_audience }).subscribe(
      token => {
        success({ headers: new HttpHeaders({ 'Authorization': `Bearer ${token}` }) });
      },
      (err) => {
        // The Auth0 session has expired: send the user to log in again rather than firing an
        // unauthenticated request, which the API rejects as a confusing "Access Denied".
        //
        // The loggedIn check is load-bearing, not redundant: Auth0 rejects with these same
        // error codes for "never had a session" (an anonymous visitor on a public route such
        // as /organisation-device-request) as for "session expired". loggedIn only ever
        // becomes true after isAuthenticated$ emits true, so it distinguishes the two —
        // without it every anonymous visitor is bounced to the Auth0 login (2026-07-28
        // production incident). Anonymous visitors fall through to success({}) and the
        // request goes out unauthenticated, which the public resolvers accept. An expired
        // staff session mid-use still redirects (loggedIn is true by then); a fresh load
        // with an expired session is handled by AuthGuard on guarded routes.
        if (err && REAUTH_ERROR_CODES.includes(err.error) && authService.loggedIn) {
          redirectToLogin();
        }
        success({});
      }
    );
  }));

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
