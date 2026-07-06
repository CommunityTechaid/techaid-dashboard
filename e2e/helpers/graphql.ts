/**
 * GraphQL teardown helper for the Batch 5 write-flow e2e specs.
 *
 * The write-flow specs (5.2–5.6) create REAL records in the UAT backend
 * (api-testing.communitytechaid.org.uk). This helper lets a spec:
 *   1. talk to the UAT GraphQL API directly via Playwright's request context,
 *      authenticated with the bearer token already saved in e2e/.auth/user.json
 *      (the same token the browser specs inject via page.route); and
 *   2. register the ids of records it creates so they are removed in an
 *      afterEach/afterAll teardown — even if the spec body throws mid-flight.
 *
 * ── IMPORTANT permission finding (2026-07-06) ────────────────────────────────
 * The `delete*` mutations (deleteKit / deleteDonor / deleteDeviceRequest /
 * deleteReferringOrganisation / deleteReferringOrganisationContact) return
 * **"Access Denied"** for the UAT test user's token. That token can create and
 * update (it carries write:* / app:admin) but has NO delete authority. So a
 * hard delete is not reachable from e2e with the current token.
 *
 * Teardown therefore does hard-delete-first, then falls back to an ARCHIVE
 * (soft-delete) that the token CAN perform:
 *   - donor / kit / referringOrganisation / referringOrganisationContact
 *       → update the record with `archived: true`, which drops it out of every
 *         default (non-archived) list and detail view the UI shows.
 *   - deviceRequest has no `archived` flag and its update constructor rejects a
 *       minimal status-only payload (it requires the nested items/needs inputs),
 *       so there is no safe generic soft-delete — it is hard-delete-only. With
 *       the current token a device-request record cannot be auto-removed; the
 *       teardown logs a loud warning so it can be cleaned up by hand (or by a
 *       delete-capable token). See spec 5.3 notes.
 *
 * If a delete-capable token is ever provided, the hard-delete path just works
 * and the archive fallback never runs.
 *
 * The delete/create mutation names and signatures are copied verbatim from the
 * matching app component under src/app/views/corewidgets/components/** so the
 * helper exercises the exact same schema surface the UI does.
 *
 * SAFETY: only ever remove records this helper created (track ids as you go).
 * Never touch pre-existing UAT records.
 */
import { APIRequestContext, request } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Direct UAT GraphQL endpoint. The request context is a Node-side HTTP client
 * (no browser CORS enforcement), so we hit the real API directly rather than
 * going through the ng-serve proxy — teardown then works even if page
 * navigation failed.
 */
export const UAT_GRAPHQL_ENDPOINT =
  'https://api-testing.communitytechaid.org.uk/graphql';

/** Entities Batch 5 needs to be able to tear down. */
export type EntityKind =
  | 'kit'
  | 'deviceRequest'
  | 'donor'
  | 'referringOrganisation'
  | 'referringOrganisationContact';

/** How to remove one tracked entity: the hard delete plus an optional archive fallback. */
interface EntityTeardown {
  /** Hard-delete mutation, verbatim from the app component. Returns Boolean. */
  deleteMutation: string;
  /**
   * Archive (soft-delete) fallback used when the hard delete is denied. Given a
   * client and id, it fetches the fields the update input requires and
   * resubmits them with the record flagged out of view. `undefined` = no safe
   * generic soft-delete (deviceRequest).
   */
  archive?: (client: UatGraphQLClient, id: string) => Promise<void>;
}

/**
 * Per-entity teardown wiring.
 *
 * deleteMutation copied from:
 *   kit                          → kit-info.component.ts
 *   deviceRequest                → device-request-info.component.ts
 *   donor                        → donor-info.component.ts
 *   referringOrganisation        → referring-organisation-info.component.ts
 *   referringOrganisationContact → referring-organisation-contact-info.component.ts
 *
 * The archive fallbacks re-fetch the minimum fields the corresponding
 * Update*Input constructor requires (verified against the UAT schema) and
 * resubmit them with `archived: true`.
 */
const ENTITY_TEARDOWN: Record<EntityKind, EntityTeardown> = {
  donor: {
    deleteMutation: 'mutation deleteDonor($id: ID!) { deleteDonor(id: $id) }',
    async archive(client, id) {
      const { donor } = await client.request<{ donor: DonorRow | null }>(
        `query ($id: Long) {
          donor(where: { id: { _eq: $id } }) {
            name email phoneNumber postCode referral isLeadContact
            donorParent { id }
          }
        }`,
        { id },
      );
      if (!donor) return; // already gone
      await client.request(
        `mutation ($data: UpdateDonorInput!) { updateDonor(data: $data) { id archived } }`,
        {
          data: {
            id,
            name: donor.name,
            email: donor.email,
            phoneNumber: donor.phoneNumber,
            postCode: donor.postCode,
            referral: donor.referral,
            isLeadContact: donor.isLeadContact,
            donorParentId: donor.donorParent?.id ?? null,
            archived: true,
          },
        },
      );
    },
  },
  kit: {
    deleteMutation: 'mutation deleteKit($id: ID!) { deleteKit(id: $id) }',
    async archive(client, id) {
      const { kit } = await client.request<{ kit: KitRow | null }>(
        `query ($id: Long) {
          kit(where: { id: { _eq: $id } }) { type status model }
        }`,
        { id },
      );
      if (!kit) return;
      // UpdateKitInput's constructor is satisfied by just the non-null fields
      // (type/status/model) plus archived — verified against the UAT schema.
      await client.request(
        `mutation ($data: UpdateKitInput!) { updateKit(data: $data) { id archived } }`,
        {
          data: {
            id,
            type: kit.type,
            status: kit.status,
            model: kit.model,
            archived: true,
          },
        },
      );
    },
  },
  referringOrganisation: {
    deleteMutation:
      'mutation deleteReferringOrganisation($id: ID!) { deleteReferringOrganisation(id: $id) }',
    async archive(client, id) {
      const { referringOrganisation: org } = await client.request<{
        referringOrganisation: OrgRow | null;
      }>(
        `query ($id: Long) {
          referringOrganisation(where: { id: { _eq: $id } }) { name website phoneNumber }
        }`,
        { id },
      );
      if (!org) return;
      await client.request(
        `mutation ($data: UpdateReferringOrganisationInput!) {
          updateReferringOrganisation(data: $data) { id archived }
        }`,
        {
          data: {
            id,
            name: org.name,
            website: org.website,
            phoneNumber: org.phoneNumber,
            archived: true,
          },
        },
      );
    },
  },
  referringOrganisationContact: {
    deleteMutation:
      'mutation deleteReferringOrganisationContact($id: ID!) { deleteReferringOrganisationContact(id: $id) }',
    async archive(client, id) {
      const { referringOrganisationContact: contact } = await client.request<{
        referringOrganisationContact: ContactRow | null;
      }>(
        `query ($id: Long) {
          referringOrganisationContact(where: { id: { _eq: $id } }) {
            fullName address email phoneNumber
            referringOrganisation { id }
          }
        }`,
        { id },
      );
      if (!contact) return;
      await client.request(
        `mutation ($data: UpdateReferringOrganisationContactInput!) {
          updateReferringOrganisationContact(data: $data) { id archived }
        }`,
        {
          data: {
            id,
            fullName: contact.fullName,
            address: contact.address,
            email: contact.email,
            phoneNumber: contact.phoneNumber,
            referringOrganisationId: contact.referringOrganisation?.id ?? null,
            note: null,
            archived: true,
          },
        },
      );
    },
  },
  deviceRequest: {
    // Hard-delete only: no `archived` flag, and updateDeviceRequest rejects a
    // minimal status-only payload (constructor requires the nested items/needs
    // inputs). With a non-delete token these must be cleaned up by hand.
    deleteMutation:
      'mutation deleteDeviceRequest($id: ID!) { deleteDeviceRequest(id: $id) }',
  },
};

interface DonorRow {
  name: string;
  email: string;
  phoneNumber: string;
  postCode: string;
  referral: string;
  isLeadContact: boolean;
  donorParent: { id: string } | null;
}
interface KitRow {
  type: string;
  status: string;
  model: string;
}
interface OrgRow {
  name: string;
  website: string;
  phoneNumber: string;
}
interface ContactRow {
  fullName: string;
  address: string;
  email: string;
  phoneNumber: string;
  referringOrganisation: { id: string } | null;
}

interface TrackedRecord {
  kind: EntityKind;
  id: string;
}

/** True when a thrown GraphQL error is the UAT token's missing-delete-authority. */
function isAccessDenied(err: unknown): boolean {
  return /Access Denied/i.test((err as Error)?.message ?? '');
}

/**
 * Reads the UAT bearer token out of the Playwright storageState written by
 * e2e/save-token.mjs. Same extraction the browser specs use.
 */
export function getBearerToken(
  statePath = resolve(process.cwd(), 'e2e/.auth/user.json'),
): string {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) {
        const parsed = JSON.parse(item.value);
        const token = parsed?.body?.access_token;
        if (token) return token;
      }
    }
  }
  throw new Error(
    `No Auth0 access token found in ${statePath} — run e2e/save-token.mjs first.`,
  );
}

/**
 * Authenticated client for the UAT GraphQL API plus a record tracker.
 *
 * Usage in a spec:
 *   let uat: UatGraphQLClient;
 *   test.beforeAll(async () => { uat = await UatGraphQLClient.create(); });
 *   test.afterAll(async () => { await uat.dispose(); });   // removes tracked records
 *
 *   const donor = await uat.createDonor({ name: 'E2E Probe', email: '...' });
 *   // ...drive the UI, assert...
 *   // donor is auto-tracked; dispose() removes it.
 *
 * For records created through the UI, capture the new id and call
 *   uat.track('kit', newId);
 * so teardown removes it too.
 */
export class UatGraphQLClient {
  private tracked: TrackedRecord[] = [];

  private constructor(private readonly ctx: APIRequestContext) {}

  /** Creates a client with an Authorization header baked into every request. */
  static async create(token = getBearerToken()): Promise<UatGraphQLClient> {
    const ctx = await request.newContext({
      extraHTTPHeaders: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return new UatGraphQLClient(ctx);
  }

  /** Runs an arbitrary GraphQL document. Throws on transport or GraphQL errors. */
  async request<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.ctx.post(UAT_GRAPHQL_ENDPOINT, {
      data: { query, variables },
    });
    if (!res.ok()) {
      throw new Error(
        `GraphQL HTTP ${res.status()} ${res.statusText()}: ${await res.text()}`,
      );
    }
    const json = await res.json();
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data as T;
  }

  /**
   * Registers a record for removal at teardown. Safe to call with a null/empty
   * id (ignored), so specs can `track(kind, res?.id)` without guarding.
   */
  track(kind: EntityKind, id: string | number | null | undefined): void {
    if (id === null || id === undefined || id === '') return;
    this.tracked.push({ kind, id: String(id) });
  }

  // --- Convenience creators (create + auto-track). ---------------------------
  // Handy for specs that need a fixture record without driving the UI, and for
  // the round-trip smoke test. Field shape mirrors the app's CreateDonorInput.
  // NOTE: the Kotlin input constructors require every field to be PRESENT (even
  // nullable ones), so pass the full object.

  async createDonor(data: {
    name: string;
    email?: string | null;
    phoneNumber?: string | null;
    postCode?: string | null;
    referral?: string | null;
    isLeadContact?: boolean;
    donorParentId?: string | null;
  }): Promise<{ id: string; name: string; email: string }> {
    const res = await this.request<{
      createDonor: { id: string; name: string; email: string };
    }>(
      `mutation createDonor($data: CreateDonorInput!) {
        createDonor(data: $data) { id name email phoneNumber postCode }
      }`,
      {
        data: {
          email: null,
          phoneNumber: null,
          postCode: null,
          referral: null,
          isLeadContact: false,
          donorParentId: null,
          ...data,
        },
      },
    );
    this.track('donor', res.createDonor.id);
    return res.createDonor;
  }

  /**
   * Removes every tracked record (most-recent first, so children go before
   * parents). For each: try the hard delete; if that is denied, fall back to
   * archiving the record out of view. Never throws — per-record failures are
   * collected and logged so one stuck record cannot fail an otherwise-green
   * spec or mask the rest. Clears the tracking list, so a second call is a
   * no-op.
   */
  async cleanup(): Promise<void> {
    const failures: string[] = [];
    for (const rec of [...this.tracked].reverse()) {
      const teardown = ENTITY_TEARDOWN[rec.kind];
      try {
        await this.request(teardown.deleteMutation, { id: rec.id });
      } catch (err) {
        // Hard delete unavailable (Access Denied for the UAT token) → archive.
        if (isAccessDenied(err) && teardown.archive) {
          try {
            await teardown.archive(this, rec.id);
          } catch (archiveErr) {
            failures.push(
              `${rec.kind}#${rec.id}: delete denied, archive failed: ` +
                `${(archiveErr as Error).message}`,
            );
          }
        } else {
          failures.push(`${rec.kind}#${rec.id}: ${(err as Error).message}`);
        }
      }
    }
    this.tracked = [];
    if (failures.length) {
      console.warn(
        `[uat-teardown] ${failures.length} record(s) could not be removed — ` +
          `manual cleanup may be needed:\n  ${failures.join('\n  ')}`,
      );
    }
  }

  /** cleanup() + release the underlying request context. Call in afterAll. */
  async dispose(): Promise<void> {
    await this.cleanup();
    await this.ctx.dispose();
  }
}
