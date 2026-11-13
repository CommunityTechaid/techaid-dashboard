// Preload for cleanup-kit-guard.spec.ts: replaces global fetch so e2e/cleanup-residue.mjs runs
// against an in-memory fixture (env CLEANUP_FIXTURE, JSON) and never touches UAT. Each delete
// mutation is printed as `MUT <mutation> <id>`; deleting a contact/organisation that a remaining
// request still points at fails like the real foreign key would.
const fx = JSON.parse(process.env.CLEANUP_FIXTURE);
const gone = new Set();
const lists = {
  donorsConnection: fx.donors ?? [],
  kitsConnection: fx.kits ?? [],
  referringOrganisationContactsConnection: fx.contacts ?? [],
  referringOrganisationsConnection: fx.organisations ?? [],
  deviceRequestConnection: fx.requests ?? [],
};
globalThis.fetch = async (_url, init) => {
  const { query, variables } = JSON.parse(init.body);
  const del = /(delete\w+)\(id/.exec(query);
  let body;
  if (del) {
    const id = String(variables.id);
    const live = (fx.requests ?? []).filter(r => !gone.has(`deleteDeviceRequest:${r.id}`));
    const refd =
      (del[1] === 'deleteReferringOrganisationContact' && live.some(r => String(r.referringOrganisationContact?.id) === id)) ||
      (del[1] === 'deleteReferringOrganisation' && live.some(r => String(r.referringOrganisationContact?.referringOrganisation?.id) === id));
    if (refd) body = { errors: [{ message: 'violates foreign key constraint on table device_requests' }] };
    else {
      gone.add(`${del[1]}:${id}`);
      console.log(`MUT ${del[1]} ${id}`);
      body = { data: { [del[1]]: true } };
    }
  } else {
    const field = Object.keys(lists).find(k => query.includes(k));
    body = { data: { [field]: { content: lists[field] } } };
  }
  return { json: async () => body };
};
