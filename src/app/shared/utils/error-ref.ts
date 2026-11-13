/**
 * Error refs for GraphQL operations (#381, parts a and b).
 *
 * Every GraphQL operation gets a short ref, sent to the API as the `X-CTA-Ref` header. The server
 * logs it and returns it in each error's `extensions.ref` (techaid-server#371), and a failed
 * operation is reported to Application Insights with the same ref, so the ref a staff member
 * quotes finds both the browser's exception row and the server's `AppTraces` row.
 *
 * Kept free of Angular and of path aliases on purpose: `e2e/tests/graphql-error-ref.spec.ts` runs
 * these links inside a plain Node ApolloClient to check what the subscriber actually receives.
 *
 * Do not call it a "correlation" id: that word already means the Typeform link on the public
 * request form (org-request.ts).
 */
import { ApolloLink } from '@apollo/client/link';
import type { FormattedExecutionResult } from 'graphql';
import { tap } from 'rxjs/operators';

/** Request header the API reads (techaid-server#371 accepts `^[A-Za-z0-9-]{1,32}$`). */
export const REF_HEADER = 'X-CTA-Ref';

/**
 * Unambiguous when read aloud or copied by hand from a toast: no 0/O, 1/I/L. 31 characters, so 8
 * of them give about 2^39 values, plenty to tell one page load's failures apart.
 */
export const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REF_LENGTH = 8;

/** Operation-context keys. The ref lives on the context, so a re-sent operation keeps it. */
const REF_CONTEXT_KEY = 'ctaRef';
/** Set once the operation has actually been handed to the HTTP link (see refHeaderLink). */
const REF_SENT_CONTEXT_KEY = 'ctaRefSent';

/** The API's ref pattern, used to trust a ref read back from a server error's extensions. */
const SERVER_REF_PATTERN = /^[A-Za-z0-9-]{1,32}$/;
/** What may go into telemetry from `extensions.classification`: an enum name, nothing else. */
const CLASSIFICATION_PATTERN = /^[A-Za-z_]{1,64}$/;

/** A new ref from crypto.getRandomValues (never Math.random), unbiased by rejection sampling. */
export function newRef(): string {
  // 248 = 31 * 8: bytes from 248 to 255 would favour the first 8 characters, so they are skipped.
  const limit = 256 - (256 % REF_ALPHABET.length);
  let ref = '';
  while (ref.length < REF_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(REF_LENGTH * 2));
    for (const byte of bytes) {
      if (byte < limit && ref.length < REF_LENGTH) {
        ref += REF_ALPHABET[byte % REF_ALPHABET.length];
      }
    }
  }
  return ref;
}

/**
 * Error objects the link chain saw, mapped to their operation's ref. A WeakMap, so nothing is kept
 * alive by it. Keys are the transport error instance itself, and for a GraphQL (HTTP 200) error
 * the `errors` array and each error object of the result, because Apollo builds a NEW
 * CombinedGraphQLErrors for the subscriber: it is not the instance any link saw, but it holds the
 * same `errors` array and objects (pinned by graphql-error-ref.spec.ts).
 */
const refs = new WeakMap<object, string>();

const remember = (key: unknown, ref: string) => {
  if (key && typeof key === 'object') {
    refs.set(key, ref);
  }
};

/**
 * The ref of the operation that produced `error`, as given to a subscriber's error callback (or as
 * `result.error` from a watchQuery), or undefined when it never reached the API: for example a
 * failed token fetch, which has no server row to find.
 *
 * Falls back to a server-issued `extensions.ref` (techaid-server#371), which is the same ref once
 * the server half is deployed.
 */
export function refForError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const direct = refs.get(error);
  if (direct) {
    return direct;
  }
  const errors = (error as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    const fromArray = refs.get(errors);
    if (fromArray) {
      return fromArray;
    }
    for (const item of errors) {
      const fromItem = item && typeof item === 'object' ? refs.get(item) : undefined;
      if (fromItem) {
        return fromItem;
      }
    }
    for (const item of errors) {
      const serverRef = item?.extensions?.ref;
      if (typeof serverRef === 'string' && SERVER_REF_PATTERN.test(serverRef)) {
        return serverRef;
      }
    }
  }
  return undefined;
}

/** One failed operation, described only by parts that are safe to send to telemetry. */
export interface FailedOperation {
  ref: string;
  /** From the document, e.g. `updateKit`; `(anonymous)` for an unnamed one. */
  operationName: string;
  /** `GraphQL` (HTTP 200 with errors[]), `HTTP <status>`, or `network` (no response). */
  kind: string;
  /** Distinct `extensions.classification` values, if the server sent any (e.g. `ValidationError`). */
  classifications: string[];
}

/**
 * Builds the telemetry error. Deliberately NOT the server's message (it can carry personal data
 * and record ids) and no variables: only the parts of FailedOperation.
 */
export function failedOperationError(failure: FailedOperation): Error {
  const classification = failure.classifications.length ? `, ${failure.classifications.join('/')}` : '';
  const error = new Error(
    `GraphQL operation ${failure.operationName} failed (${failure.kind}${classification}), ref ${failure.ref}`,
  );
  error.name = 'GraphQLOperationError';
  return error;
}

const statusOf = (error: unknown): number | undefined => {
  const e = error as { statusCode?: unknown; status?: unknown } | null;
  const status = e?.statusCode ?? e?.status;
  return typeof status === 'number' && status > 0 ? status : undefined;
};

const classificationsOf = (errors: readonly unknown[]): string[] => {
  const found = errors
    .map(item => (item as { extensions?: { classification?: unknown } })?.extensions?.classification)
    .filter((value): value is string => typeof value === 'string' && CLASSIFICATION_PATTERN.test(value));
  return [...new Set(found)];
};

/**
 * Outermost link: gives the operation its ref, and when the operation finally fails, records the
 * error for refForError and calls `report` once.
 *
 * Being outermost means it sees only the final outcome: a public-page 401 that the error link
 * re-sends without the token (#391) is not reported, and is reported once (with the same ref) only
 * if the retry fails too. An error from an operation that never reached the HTTP link (a failed
 * token fetch in the auth link) gets no ref and no report: there is no server row it could match.
 * Errors and results pass through untouched; callers parse the raw messages (fit note 6).
 */
export function createErrorRefLink(report: (failure: FailedOperation) => void): ApolloLink {
  return new ApolloLink((operation, forward) => {
    if (!operation.getContext()[REF_CONTEXT_KEY]) {
      operation.setContext({ [REF_CONTEXT_KEY]: newRef() });
    }
    const sentRef = (): string | undefined => {
      const context = operation.getContext();
      return context[REF_SENT_CONTEXT_KEY] ? context[REF_CONTEXT_KEY] : undefined;
    };
    const failed = (kind: string, classifications: string[], ref: string) => {
      try {
        report({ ref, operationName: operation.operationName || '(anonymous)', kind, classifications });
      } catch {
        // Reporting must never change what the caller receives.
      }
    };
    return forward(operation).pipe(
      tap({
        next: result => {
          const errors = (result as FormattedExecutionResult)?.errors;
          const ref = sentRef();
          if (ref && Array.isArray(errors) && errors.length) {
            remember(errors, ref);
            errors.forEach(item => remember(item, ref));
            failed('GraphQL', classificationsOf(errors), ref);
          }
        },
        error: error => {
          const ref = sentRef();
          if (ref) {
            remember(error, ref);
            const status = statusOf(error);
            failed(status ? `HTTP ${status}` : 'network', [], ref);
          }
        },
      }),
    );
  });
}

/**
 * Innermost link, next to the HTTP link: adds the ref header. It sits after the auth link because
 * that link sets a whole new `headers` value on the token path, which would drop a header added
 * before it. Merges into whatever is there (Angular HttpHeaders or a plain object).
 */
export const refHeaderLink = new ApolloLink((operation, forward) => {
  const context = operation.getContext();
  const ref: string = context[REF_CONTEXT_KEY] ?? newRef();
  const headers = context['headers'];
  const withRef = headers && typeof (headers as { set?: unknown }).set === 'function'
    ? (headers as { set(name: string, value: string): unknown }).set(REF_HEADER, ref)
    : { ...((headers as Record<string, string>) ?? {}), [REF_HEADER]: ref };
  // Typed as the plain-object form only so this file need not import Angular (see the header);
  // the HTTP link accepts either form.
  operation.setContext({ [REF_CONTEXT_KEY]: ref, [REF_SENT_CONTEXT_KEY]: true, headers: withRef as Record<string, string> });
  return forward(operation);
});
