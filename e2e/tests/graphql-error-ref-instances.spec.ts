/**
 * #381 fit note 3: can a toast find the ref of the error its subscriber received?
 *
 * Components only see the error in their own `subscribe` error callback (or `result.error` from a
 * watchQuery), never the operation context, so `refForError(err)` (src/app/shared/utils/
 * error-ref.ts) must work on the object Apollo actually hands them. This runs the real ref links
 * in a plain Node ApolloClient (no browser), with a terminating link standing in for the HTTP link
 * and a real ErrorLink between them as in graphql.module.ts, and checks query, watchQuery and
 * mutate for an HTTP-200 errors[] response and for a transport error.
 *
 * Finding (Apollo Client 4.3, pinned below):
 *   - a transport error reaches the subscriber as the SAME instance the links saw;
 *   - an HTTP-200 errors[] response does NOT: no link ever sees the subscriber's
 *     CombinedGraphQLErrors (QueryManager builds a new one after the chain; ErrorLink's handler
 *     gets a different one again), but the new instance holds the very same `errors` array and
 *     error objects the result carried. refForError therefore also keys on those.
 * apollo-angular 14 passes errors through untouched (`query`/`mutate` reject with the client's
 * error, `watchQuery().valueChanges` is `from(observableQuery)`), so this holds for the app's
 * `Apollo` service too.
 *
 * @mocked — no network, no browser.
 */
import { test, expect } from '@playwright/test';
import { ApolloClient, ApolloLink, CombinedGraphQLErrors, InMemoryCache, gql } from '@apollo/client';
import { ErrorLink } from '@apollo/client/link/error';
import { Observable, of, throwError } from 'rxjs';
import {
  createErrorRefLink, FailedOperation, REF_HEADER, refForError, refHeaderLink,
} from '../../src/app/shared/utils/error-ref';

const QUERY = gql`query refProbe($id: ID!) { probe(id: $id) { id } }`;
const MUTATION = gql`mutation refProbeSave($id: ID!) { save(id: $id) { id } }`;

interface Harness {
  client: ApolloClient;
  /** Refs the "server" received, in order. */
  sentRefs: string[];
  /** What ErrorLink's handler was given. */
  errorLinkSaw: unknown[];
  /** The `errors` array of each result the terminating link returned. */
  resultErrors: unknown[];
  reports: FailedOperation[];
}

function harness(outcome: 'graphql' | 'transport' | 'token-failure', transportError?: Error): Harness {
  const h: Harness = { client: undefined as unknown as ApolloClient, sentRefs: [], errorLinkSaw: [], resultErrors: [], reports: [] };
  const terminating = new ApolloLink(operation => {
    h.sentRefs.push(operation.getContext()['headers']?.[REF_HEADER]);
    if (outcome === 'transport') {
      return throwError(() => transportError);
    }
    const errors = [{ message: 'raw server text', extensions: { classification: 'ValidationError' } }];
    h.resultErrors.push(errors);
    return of({ data: null, errors });
  });
  const failingAuth = new ApolloLink(() => new Observable(subscriber => subscriber.error(new Error('login_required'))));
  h.client = new ApolloClient({
    cache: new InMemoryCache(),
    link: ApolloLink.from([
      createErrorRefLink(failure => h.reports.push(failure)),
      new ErrorLink(({ error }) => { h.errorLinkSaw.push(error); }),
      ...(outcome === 'token-failure' ? [failingAuth] : []),
      refHeaderLink,
      terminating,
    ]),
  });
  return h;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to fail');
}

/** The first watchQuery emission that carries an error (Apollo 4 emits it as `result.error`). */
function watchError(client: ApolloClient): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Resolving settles the promise; the subscription ends with the test's client.
    client.watchQuery({ query: QUERY, variables: { id: '1' } }).subscribe({
      next: result => { if (result.error) resolve(result.error); },
      error: error => resolve(error),
    });
    setTimeout(() => reject(new Error('watchQuery never delivered an error')), 5_000);
  });
}

const deliver = {
  query: (h: Harness) => caught(h.client.query({ query: QUERY, variables: { id: '1' } })),
  watchQuery: (h: Harness) => watchError(h.client),
  mutate: (h: Harness) => caught(h.client.mutate({ mutation: MUTATION, variables: { id: '1' } })),
};

test.describe('refForError finds the ref of the error a subscriber receives @mocked', () => {
  for (const [method, run] of Object.entries(deliver)) {
    test(`${method}: an HTTP-200 errors[] response`, async () => {
      const h = harness('graphql');
      const error = await run(h) as CombinedGraphQLErrors;

      expect(CombinedGraphQLErrors.is(error)).toBe(true);
      expect(h.sentRefs).toHaveLength(1);
      expect(refForError(error), 'the ref the request carried').toBe(h.sentRefs[0]);
      // The finding: a new instance, holding the result's own errors array.
      expect(h.errorLinkSaw[0], 'ErrorLink saw a different instance').not.toBe(error);
      expect(error.errors, 'same errors array as the result').toBe(h.resultErrors[0]);
      expect(h.reports).toEqual([
        { ref: h.sentRefs[0], operationName: method === 'mutate' ? 'refProbeSave' : 'refProbe', kind: 'GraphQL', classifications: ['ValidationError'] },
      ]);
    });

    test(`${method}: a transport error`, async () => {
      const transportError = Object.assign(new Error('Response not successful: Received status code 502'), { statusCode: 502 });
      const h = harness('transport', transportError);
      const error = await run(h);

      expect(error, 'the subscriber gets the instance the links saw').toBe(transportError);
      expect(h.errorLinkSaw[0]).toBe(transportError);
      expect(refForError(error)).toBe(h.sentRefs[0]);
      expect(h.reports).toHaveLength(1);
      expect(h.reports[0]).toMatchObject({ ref: h.sentRefs[0], kind: 'HTTP 502' });
    });
  }

  test('an operation that never reached the HTTP link has no ref and is not reported', async () => {
    const h = harness('token-failure');
    const error = await deliver.query(h);

    expect(String(error)).toContain('login_required');
    expect(h.sentRefs).toEqual([]);
    expect(refForError(error)).toBeUndefined();
    expect(h.reports).toEqual([]);
  });

  test('a server-issued extensions.ref is used when the link has no record of the error', () => {
    expect(refForError({ errors: [{ message: 'x', extensions: { ref: 'ABCD2345' } }] })).toBe('ABCD2345');
    expect(refForError({ errors: [{ message: 'x', extensions: { ref: '<script>' } }] })).toBeUndefined();
    expect(refForError(new Error('unrelated'))).toBeUndefined();
    expect(refForError(undefined)).toBeUndefined();
  });
});
