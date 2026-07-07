/**
 * One-command cleanup for E2E sample records left in the UAT backend.
 *
 * The Batch 5 write-flow specs create real UAT records and try to hard-delete
 * them in teardown. When the saved token has no delete authority they fall back
 * to archiving (donors/kits/orgs/contacts) or leave the record (device requests,
 * which have no archive path) — so residue accumulates. Every sample record is
 * named with the shared "E2E" marker (see e2e/helpers/sample-data.ts), so this
 * tool can find and remove ALL of it in one pass, across entity types.
 *
 * Usage (reads the same token as the specs, from e2e/.auth/user.json):
 *
 *   node e2e/cleanup-residue.mjs            # dry run: list what would be removed
 *   node e2e/cleanup-residue.mjs --delete   # actually hard-delete it
 *   npm run e2e:cleanup -- --delete
 *
 * Hard delete needs a delete-capable token. With the current read/write/admin
 * token every delete returns "Access Denied"; the tool reports that clearly and
 * changes nothing. Point e2e/.auth/user.json at a token that carries delete
 * scopes and re-run with --delete to purge the backlog.
 *
 * SAFETY: only ever touches records whose identifying field contains "E2E".
 * Real CommunityTechAid records do not, so this cannot remove live data. It runs
 * against api-testing (UAT) only.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENDPOINT = 'https://api-testing.communitytechaid.org.uk/graphql';
const MARKER = 'E2E'; // matches "E2E Sample …" and legacy "E2E-5.x" / "E2E teardown …"
const DELETE = process.argv.includes('--delete');

function getToken() {
  const statePath = resolve(process.cwd(), 'e2e/.auth/user.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name.startsWith('@@auth0spajs@@')) {
        const token = JSON.parse(item.value)?.body?.access_token;
        if (token) return token;
      }
    }
  }
  throw new Error(`No token in ${statePath} — run e2e/save-token.mjs first.`);
}

const token = getToken();
const gql = async (query, variables = {}) => {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
};

// One descriptor per entity: how to list its sample records and how to delete one.
const ENTITIES = [
  {
    kind: 'donor',
    list: `query { donorsConnection(page:{size:500}, where:{ name:{_contains:"${MARKER}"} }){ content{ id name archived } } }`,
    pick: d => d.donorsConnection.content,
    label: r => r.name,
    del: 'mutation($id: ID!) { deleteDonor(id: $id) }',
  },
  {
    kind: 'kit',
    list: `query { kitsConnection(page:{size:500}, where:{ model:{_contains:"${MARKER}"} }){ content{ id model archived } } }`,
    pick: d => d.kitsConnection.content,
    label: r => r.model,
    del: 'mutation($id: ID!) { deleteKit(id: $id) }',
  },
  {
    kind: 'referringOrganisationContact',
    list: `query { referringOrganisationContactsConnection(page:{size:500}, where:{ fullName:{_contains:"${MARKER}"} }){ content{ id fullName archived } } }`,
    pick: d => d.referringOrganisationContactsConnection.content,
    label: r => r.fullName,
    del: 'mutation($id: ID!) { deleteReferringOrganisationContact(id: $id) }',
  },
  {
    kind: 'referringOrganisation',
    list: `query { referringOrganisationsConnection(page:{size:500}, where:{ name:{_contains:"${MARKER}"} }){ content{ id name archived } } }`,
    pick: d => d.referringOrganisationsConnection.content,
    label: r => r.name,
    del: 'mutation($id: ID!) { deleteReferringOrganisation(id: $id) }',
  },
  {
    kind: 'deviceRequest',
    list: `query { deviceRequestConnection(page:{size:500}, where:{ clientRef:{_contains:"${MARKER}"} }){ content{ id clientRef } } }`,
    pick: d => d.deviceRequestConnection.content,
    label: r => r.clientRef,
    del: 'mutation($id: ID!) { deleteDeviceRequest(id: $id) }',
  },
];

let found = 0, deleted = 0, denied = 0, failed = 0;

for (const e of ENTITIES) {
  const res = await gql(e.list);
  if (res.errors) {
    console.error(`  ! ${e.kind}: list failed — ${JSON.stringify(res.errors)}`);
    continue;
  }
  const rows = e.pick(res.data) ?? [];
  found += rows.length;
  console.log(`\n${e.kind}: ${rows.length} sample record(s)`);
  for (const row of rows) {
    const tag = `#${row.id} "${e.label(row)}"${row.archived ? ' (archived)' : ''}`;
    if (!DELETE) {
      console.log(`  would delete ${tag}`);
      continue;
    }
    const del = await gql(e.del, { id: row.id });
    if (del.errors) {
      const msg = del.errors[0]?.message ?? 'error';
      if (/Access Denied/i.test(msg)) { denied++; console.log(`  DENIED  ${tag}`); }
      else { failed++; console.log(`  FAILED  ${tag} — ${msg}`); }
    } else {
      deleted++; console.log(`  deleted ${tag}`);
    }
  }
}

console.log('\n=== summary ===');
console.log(`found: ${found}`);
if (DELETE) {
  console.log(`deleted: ${deleted}, access-denied: ${denied}, failed: ${failed}`);
  if (denied) {
    console.log('\nThis token cannot hard-delete. Point e2e/.auth/user.json at a');
    console.log('delete-capable token and re-run with --delete to purge the backlog.');
  }
} else {
  console.log('dry run — re-run with --delete to remove these records.');
}
