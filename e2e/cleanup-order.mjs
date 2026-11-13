/**
 * Delete order for e2e/cleanup-residue.mjs, kept in its own side-effect-free module so a spec
 * can assert it without triggering a cleanup run.
 *
 * Each entry must come BEFORE the entities it depends on being gone first. Confirmed against
 * techaid-server:
 *  - a device request holds foreign keys to its referee contact and organisation (a contact
 *    with a request cannot be deleted: "violates foreign key constraint ... on table
 *    device_requests"), so deviceRequest -> referringOrganisationContact -> referringOrganisation;
 *  - deleteDeviceRequest cascades to the request's kits (DeviceRequest.kits is CascadeType.ALL),
 *    and deleteDonor detaches kits first, so donor and kit carry no ordering constraint against
 *    the rest; they stay first so a sample kit is deleted explicitly before its request goes.
 */
export const DELETE_ORDER = [
  'donor',
  'kit',
  'deviceRequest',
  'referringOrganisationContact',
  'referringOrganisation',
];

/** Returns `entities` (objects with a `kind`) sorted into DELETE_ORDER; throws on an unknown kind. */
export function inDeleteOrder(entities) {
  return DELETE_ORDER.map(kind => {
    const e = entities.find(x => x.kind === kind);
    if (!e) throw new Error(`cleanup: no entity descriptor for "${kind}"`);
    return e;
  });
}
