import { Injector, Provider } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Apollo, APOLLO_OPTIONS } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { ApolloClientOptions, ApolloLink, InMemoryCache } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { ServerError } from '@apollo/client/errors';
import { ConfigService } from '@app/shared/services/config.service';
import { AuthenticationService } from './shared/services/authentication.service';
import { AppInsightsService } from './shared/services/app-insights.service';
import { createErrorRefLink, failedOperationError, FailedOperation, refHeaderLink } from './shared/utils/error-ref';
import { firstValueFrom, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, switchMap, take } from 'rxjs/operators';

// Auth0 error codes that mean the session is genuinely gone and the user must log in again
// (as opposed to a transient/network failure, where bouncing them to Auth0 would be wrong).
const REAUTH_ERROR_CODES = ['login_required', 'consent_required', 'missing_refresh_token'];

const isReauthError = (err: any) => Boolean(err) && REAUTH_ERROR_CODES.includes(err.error);

// auth0-spa-js answers a refresh grant the tenant rejects (token expired, rotated away, revoked)
// with GenericError('invalid_grant') — there is no iframe fallback (useRefreshTokensFallback is
// off) and the dead refresh token stays cached, so every later attempt fails the same way.
// It is deliberately NOT in REAUTH_ERROR_CODES: a refresh-token rotation race also answers
// invalid_grant, and that one recovers on a retry (the winner has written a fresh token to the
// cache). So it gets ONE retry, and if it still fails the session is dead: send staff to login.
const DEAD_REFRESH_TOKEN_CODE = 'invalid_grant';
const DEAD_REFRESH_TOKEN_RETRIES = 1;
const isDeadRefreshToken = (err: any) => Boolean(err) && err.error === DEAD_REFRESH_TOKEN_CODE;

// The signed-in staff areas (guarded routes in core-widgets.routes.ts: '', '/dashboard/**',
// '/device-request-admin'). Everything else — the public request form, delivery booking, CMS
// posts — is public. Defaulting unknown paths to public is the safe direction: a new guarded
// route missing here degrades to the old behaviour, never to a login bounce for a visitor.
const isStaffArea = () => /^\/(dashboard(\/|$)|device-request-admin(\/|$)|$)/.test(window.location.pathname);

// A transient token failure is usually a lost race, not a broken session, and the winner of that
// race has by then written a fresh token to the cache — so a retry typically resolves from cache
// immediately rather than going back to the network. Two attempts is plenty; more would just
// delay surfacing a real outage.
const TOKEN_RETRY_COUNT = 2;
const TOKEN_RETRY_DELAY_MS = 250;

// Operation-context flag for the public-page 401 retry (#391). The error link sets it when it
// re-sends an operation the API rejected with HTTP 401 outside the staff area; the auth link sees
// it and sends that attempt without the token. It stays on the operation's context, so a second
// 401 on the same operation finds it set and is not retried again: at most one retry, no loop.
const TOKENLESS_RETRY_FLAG = 'tokenlessRetryAfter401';

// The forwarded operation keeps the previous attempt's context, including the headers the auth
// link set on it; setContext merges rather than replaces, so the header must be removed explicitly.
const withoutAuthorization = (headers: unknown): HttpHeaders | Record<string, string> => {
  if (headers instanceof HttpHeaders) {
    return headers.delete('Authorization');
  }
  const rest: Record<string, string> = { ...((headers as Record<string, string>) ?? {}) };
  Object.keys(rest)
    .filter(name => name.toLowerCase() === 'authorization')
    .forEach(name => delete rest[name]);
  return rest;
};

// Upper bound on failed operations reported per page load, as GlobalErrorHandler caps its own
// reports: a page that polls a failing query must not flood Azure.
const MAX_REPORTED_OPERATION_ERRORS = 50;

export function createApollo(
  httpLink: HttpLink,
  config: ConfigService,
  authService: AuthenticationService,
  injector: Injector,
): ApolloClientOptions {
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
  const asyncAuthLink = setContext((_request, previous) => previous[TOKENLESS_RETRY_FLAG]
    // The error link's one tokenless retry of a public-page operation the API rejected with 401
    // (#391). Only ever set outside the staff area; see errorHandler below.
    ? { headers: withoutAuthorization(previous['headers']) }
    : firstValueFrom(
    authService.isAuthenticated$.pipe(
      take(1),
      switchMap(isAuthenticated =>
        authService.getTokenSilently$({ audience: config.environment.auth_audience }).pipe(
          // Retry transient failures only. A genuine re-auth error is definitive: retrying it
          // just delays the redirect, and for an anonymous visitor (who always gets one of
          // these) it would delay the public form for no reason.
          retry({
            count: TOKEN_RETRY_COUNT,
            delay: (err, retryCount) =>
              isReauthError(err) || (isDeadRefreshToken(err) && retryCount > DEAD_REFRESH_TOKEN_RETRIES)
                ? throwError(() => err)
                : timer(TOKEN_RETRY_DELAY_MS),
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

            if ((isReauthError(err) || isDeadRefreshToken(err)) && !isStaffArea()) {
              // A dead session on a PUBLIC page: a browser whose cached identity still reads as
              // signed in, but whose token cannot be renewed (dead refresh token, or one of the
              // re-auth codes). Treat them as the anonymous visitor they now are: send the request
              // without a token and never redirect (see the incident note above). Pinned by
              // invalid-grant-reauth.spec.ts and expired-session-redirects-to-login.spec.ts.
              return of({});
            }

            // From here on the user is known to be authenticated, so an unauthenticated request
            // would be strictly wrong: the API would answer "Access Denied" and the UI would
            // show empty tables with no explanation.
            if (isReauthError(err) || isDeadRefreshToken(err)) {
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

  const errorHandler = onError(({ error, operation, forward }) => {
    // A 401 from the API means the token is missing/expired → prompt re-login. A GraphQL-level
    // "Access Denied" (HTTP 200, surfaced as a CombinedGraphQLErrors with no statusCode) is
    // deliberately left alone: it can be a genuine permission denial for an authenticated user,
    // and redirecting on it would cause a login loop.
    //
    // Staff areas only: on a public page a 401 means the API rejected a stale staff token the
    // browser still holds, and the visitor must never be sent to Auth0 (the 2026-07-28 incident
    // class). Instead the operation is sent once more WITHOUT the token (#391): public operations
    // are served anonymously, so this is the request an anonymous visitor would have made, and
    // without it every retry of the page's own poll carried the same rejected token. A 401 means
    // the API refused the request before running it, so re-sending a mutation is safe too. An
    // operation that genuinely needs auth just fails on the retry, as it did before.
    //
    // At most once per operation: the flag stays on the operation's context, so if the tokenless
    // attempt is also rejected the error passes through to the caller as before. Never in the
    // staff area, where a failed token must never be downgraded to an anonymous request (#164).
    const status = ServerError.is(error)
      ? error.statusCode
      : ((error as any)?.statusCode ?? (error as any)?.status);
    if (status !== 401) {
      return;
    }
    if (isStaffArea()) {
      redirectToLogin();
      return;
    }
    if (!operation.getContext()[TOKENLESS_RETRY_FLAG]) {
      operation.setContext({ [TOKENLESS_RETRY_FLAG]: true });
      return forward(operation);
    }
  });

  // #381: one exception per failed operation that reached the API, HTTP-200 GraphQL errors and
  // transport errors alike, so errors a component catches and toasts are no longer invisible to
  // Azure. Only safe parts are sent (see failedOperationError): no variables, no server message.
  // AppInsightsService is resolved on first use, as GlobalErrorHandler does: it depends on Router.
  // With no connection string it drops the call, so nothing is fetched and nothing throws.
  let reportedOperationErrors = 0;
  const reportFailedOperation = (failure: FailedOperation) => {
    if (reportedOperationErrors >= MAX_REPORTED_OPERATION_ERRORS) {
      return;
    }
    reportedOperationErrors++;
    try {
      injector.get(AppInsightsService).trackException(failedOperationError(failure), {
        source: 'apollo-error-link',
        route: location.pathname,
        ref: failure.ref,
        operation: failure.operationName,
        kind: failure.kind,
        ...(failure.classifications.length ? { classification: failure.classifications.join('/') } : {}),
      });
    } catch (reportingError) {
      console.warn('Could not report a GraphQL error to Application Insights', reportingError);
    }
  };

  // Order matters (#381):
  //   errorRefLink  outermost: gives each operation its ref and reports the FINAL outcome only,
  //                 so errorHandler's tokenless retry (#391) is reported once at most, same ref;
  //   errorHandler  401 handling (#391 retry re-enters below this point);
  //   asyncAuthLink sets `headers` wholesale on the token path;
  //   refHeaderLink adds X-CTA-Ref last, so neither auth branch nor the retry can drop it.
  return {
    link: ApolloLink.from([createErrorRefLink(reportFailedOperation), errorHandler, asyncAuthLink, refHeaderLink, http]),
    cache: new InMemoryCache(),
  };
}

export const graphqlProviders: Provider[] = [
  Apollo,
  {
    provide: APOLLO_OPTIONS,
    useFactory: createApollo,
    deps: [HttpLink, ConfigService, AuthenticationService, Injector],
  },
];
