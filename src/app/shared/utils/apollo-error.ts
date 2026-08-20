/**
 * Reading errors thrown by Apollo Client v4 through apollo-angular.
 *
 * Two things combine to make this harder than it looks.
 *
 * 1. The v3 -> v4 migration (issue #39, PR #69) removed `ApolloError`. Nothing throws an object
 *    carrying `.graphQLErrors` or `.networkError` any more; v4 throws one of a small set of named
 *    classes instead, each with its own `.is()` type guard.
 *
 * 2. apollo-angular sends its requests through Angular's `HttpClient`, not the fetch-based link
 *    `@apollo/client` uses on its own. A non-2xx response therefore never becomes Apollo's
 *    `ServerError` — it arrives as an `HttpErrorResponse`, which is **not an `Error` subclass**.
 *
 * Four hand-rolled error readers were left testing the v3 properties, so they fell through every
 * branch they had and ended at a bare `String(err)`. On an `HttpErrorResponse` that renders
 * "[object Object]" — which is exactly what the bulk-assign modal showed in production on
 * 2026-08-20, for a device the server had in fact assigned successfully:
 *
 *   - device-request-info.component.ts   bulk assign results
 *   - prep-mode.component.ts             queue + banner errors
 *   - kit-scanner.component.ts           scan feedback
 *   - org-request.ts                     the public request form
 *
 * These helpers read both shapes. The rule they exist to enforce is that no error path can render
 * "[object Object]" — an unrecognised value is JSON-serialised rather than stringified, because
 * the whole point of an error message is to name what went wrong.
 */
import { HttpErrorResponse } from '@angular/common/http';
import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
  ServerError,
  ServerParseError,
  UnconventionalError,
} from '@apollo/client/errors';

/**
 * Every GraphQL error message carried by `err`, in the order the server sent them.
 *
 * Empty for a failure that carried no GraphQL body — use `isNetworkError` to tell the two apart.
 * In v4 the messages live on `.errors`; the joined form is also available as `.message`, but
 * callers that want to match one specific message (a limit rejection, say) need them separated.
 */
export function graphQLErrorMessages(err: unknown): string[] {
  if (CombinedGraphQLErrors.is(err) || CombinedProtocolErrors.is(err)) {
    return err.errors.map(e => e?.message ?? '').filter(Boolean);
  }

  // A non-2xx response can still carry a well-formed GraphQL error body. Both transports hand it
  // over unparsed — Apollo as `bodyText`, Angular as `error` — so recover the messages the same
  // way the server framed them rather than showing only the transport's own summary line.
  if (ServerError.is(err) || ServerParseError.is(err)) {
    return messagesFromBody(err.bodyText);
  }

  if (err instanceof HttpErrorResponse) {
    return messagesFromBody(err.error);
  }

  return [];
}

/** True when the request failed at the transport level rather than returning GraphQL errors. */
export function isNetworkError(err: unknown): boolean {
  return ServerError.is(err) || ServerParseError.is(err) || err instanceof HttpErrorResponse;
}

/**
 * The most specific human-readable string available for any thrown value.
 *
 * Never returns "[object Object]".
 */
export function errorText(err: unknown): string {
  const [first] = graphQLErrorMessages(err);
  if (first) {
    return first;
  }

  if (ServerError.is(err) || ServerParseError.is(err)) {
    return err.message || `The server returned HTTP ${err.statusCode}`;
  }

  if (err instanceof HttpErrorResponse) {
    return err.message || `The server returned HTTP ${err.status}`;
  }

  // Something that was not an Error was thrown inside the link chain. v4 wraps it so it can be
  // handled like an Error, but the value worth reading is the one it wrapped. The wrapper sets
  // `cause` at runtime; its type declaration does not restate the inherited property, and this
  // project's lib target does not supply `Error.cause` either, so read it structurally.
  if (UnconventionalError.is(err)) {
    return describe((err as { cause?: unknown }).cause);
  }

  return describe(err);
}

/** Best-effort description of a value of unknown shape. */
function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message || value.name;
  }

  if (value && typeof value === 'object') {
    const { message } = value as { message?: unknown };
    if (typeof message === 'string' && message) {
      return message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      // Circular, or holding something JSON cannot represent.
      return Object.prototype.toString.call(value);
    }
  }

  return String(value);
}

/**
 * Pull `errors[].message` out of a response body, if it happens to be a GraphQL error envelope.
 * Accepts the body either as raw text or already parsed, since the two transports differ.
 */
function messagesFromBody(body: unknown): string[] {
  let parsed: unknown = body;

  if (typeof body === 'string') {
    if (!body) {
      return [];
    }
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
  }

  const errors = (parsed as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .map((e: { message?: unknown }) => (typeof e?.message === 'string' ? e.message : ''))
    .filter(Boolean);
}
