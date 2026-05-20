// Shim to preserve the DataTables.Settings / DataTables.Api namespace
// used throughout the codebase after upgrading datatables.net v1 → v2.
// In v2 the types are named exports from the package; this re-exports them
// under the legacy global namespace so no component files need to change.
import type { Config, Api } from 'datatables.net';

declare global {
  namespace DataTables {
    type Settings = Config;
    type Api = import('datatables.net').Api;
  }
}
