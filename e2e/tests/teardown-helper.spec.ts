import { test, expect } from '@playwright/test';
import { getBearerToken, UatGraphQLClient } from '../helpers/graphql';
import { sampleName } from '../helpers/sample-data';

/**
 * Real-UAT writes need a genuine, unexpired bearer token. Self-skip when the
 * saved token is expired or is the CI-minted fake (which only satisfies the
 * @mocked subset — this spec is deliberately not tagged @mocked).
 */
function uatTokenUnavailable(): string | null {
  let token: string;
  try {
    token = getBearerToken();
  } catch {
    return 'No token saved in e2e/.auth/user.json';
  }
  const [, payload, signature] = token.split('.');
  if (signature === 'ci_fake_signature') {
    return 'CI fake token — real UAT writes not possible';
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.exp * 1000 < Date.now()) {
      return 'UAT bearer token expired — run e2e/save-token.mjs with a fresh one';
    }
  } catch {
    return 'Token is not a decodable JWT';
  }
  return null;
}

const tokenProblem = uatTokenUnavailable();

/**
 * Smoke test for the Batch 5 GraphQL teardown helper (e2e/helpers/graphql.ts).
 *
 * Proves the create → verify → teardown → verify-removed round-trip against the
 * real UAT API, and that the tracker removes what it created. This spec OWNS its
 * records: whatever it creates, it removes.
 *
 * The UAT test token has no delete authority (see the helper's header comment),
 * so teardown removes the record by ARCHIVING it — which is what drops it out of
 * every default (non-archived) list and detail view the UI shows. This spec
 * asserts that end state (archived + absent from the active list).
 *
 * Not tagged @mocked: it needs the real UAT backend and a valid token.
 */
test.describe('GraphQL teardown helper', () => {
  test.skip(tokenProblem !== null, tokenProblem ?? '');

  let uat: UatGraphQLClient;

  test.beforeAll(async () => {
    uat = await UatGraphQLClient.create();
  });

  test.afterAll(async () => {
    // Safety net: dispose removes anything still tracked (a failed test may have
    // created a record without reaching its own cleanup). Green runs leave the
    // list empty, so this is a no-op then.
    await uat?.dispose();
  });

  test('creates a donor, finds it, and teardown removes it from active views', async () => {
    const marker = sampleName('Donor');

    // Create (auto-tracked by the helper).
    const donor = await uat.createDonor({
      name: marker,
      email: `e2e-teardown-${Date.now()}@example.com`,
      phoneNumber: '00000000000',
    });
    expect(donor.id).toBeTruthy();

    // Verify it exists and is active (not archived).
    const found = await uat.request<{
      donor: { id: string; name: string; archived: boolean } | null;
    }>(
      `query ($id: Long) { donor(where: { id: { _eq: $id } }) { id name archived } }`,
      { id: donor.id },
    );
    expect(found.donor?.id).toBe(String(donor.id));
    expect(found.donor?.name).toBe(marker);
    expect(found.donor?.archived).toBe(false);

    // Run teardown explicitly. Hard delete is denied for this token, so the
    // helper archives the record instead.
    await uat.cleanup();

    // Confirm it is removed from the active view: archived flag flipped, and it
    // no longer appears in the default (non-archived) donors list.
    const afterTeardown = await uat.request<{
      donor: { id: string; archived: boolean } | null;
    }>(
      `query ($id: Long) { donor(where: { id: { _eq: $id } }) { id archived } }`,
      { id: donor.id },
    );
    expect(afterTeardown.donor?.archived).toBe(true);

    const active = await uat.request<{
      donorsConnection: { content: { id: string }[] };
    }>(
      `query ($id: Long) {
        donorsConnection(where: { id: { _eq: $id }, archived: { _eq: false } }, page: { size: 5 }) {
          content { id }
        }
      }`,
      { id: donor.id },
    );
    expect(active.donorsConnection.content).toHaveLength(0);
  });
});
