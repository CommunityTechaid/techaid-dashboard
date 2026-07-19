/**
 * Types for the device prep-mode prototype (stage 2 of CommunityTechaid/techaid-server#69).
 *
 * Shapes mirror the techaid-server GraphQL `deviceRequest` / `deviceRequestConnection`
 * / `kit` surfaces so PrepApiService can talk to the real API without the page
 * component needing to know how anything is fetched.
 */

/** The eight typed item counts a device request can ask for. */
export interface DeviceRequestItems {
  phones: number;
  tablets: number;
  laptops: number;
  allInOnes: number;
  desktops: number;
  commsDevices: number;
  other: number;
  broadbandHubs: number;
}

/** A kit already assigned to (or freshly scanned onto) a request. */
export interface PrepKit {
  id: string;
  type: string;
  make?: string | null;
  model?: string | null;
  status?: string | null;
}

/** A note attached to a device request (shown to the operator for context). */
export interface PrepNote {
  id: string;
  content: string;
  volunteer?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Referee + organisation, for showing who the request belongs to. */
export interface PrepContact {
  id: string;
  fullName?: string | null;
  referringOrganisation?: { id: string; name: string } | null;
}

/** A row in the prep queue — the lightweight summary shown in the picker/progress. */
export interface PrepQueueItem {
  id: string;
  collectionDate?: string | null;
  isPrepped?: boolean | null;
  clientRef?: string | null;
  referringOrganisationContact?: PrepContact | null;
  deviceRequestItems?: DeviceRequestItems | null;
}

/** The full request loaded when an operator opens it for prepping. */
export interface PrepRequest {
  id: string;
  status: string;
  isPrepped?: boolean | null;
  isSales?: boolean | null;
  clientRef?: string | null;
  borough?: string | null;
  details?: string | null;
  collectionDate?: string | null;
  collectionMethod?: string | null;
  collectionContactName?: string | null;
  deviceRequestItems?: DeviceRequestItems | null;
  referringOrganisationContact?: PrepContact | null;
  kits?: PrepKit[] | null;
  deviceRequestNotes?: PrepNote[] | null;
}

/**
 * Maps a kit's `type` enum onto the `deviceRequestItems` count field it consumes.
 * Kit types are singular (LAPTOP); request-item keys are plural/camelCase (laptops).
 */
export const KIT_TYPE_TO_ITEM_KEY: Record<string, keyof DeviceRequestItems> = {
  LAPTOP: 'laptops',
  TABLET: 'tablets',
  SMARTPHONE: 'phones',
  ALLINONE: 'allInOnes',
  DESKTOP: 'desktops',
  COMMSDEVICE: 'commsDevices',
  BROADBANDHUB: 'broadbandHubs',
  OTHER: 'other',
};

/** Human labels for each item key, in a stable display order. */
export const ITEM_KEY_LABELS: { key: keyof DeviceRequestItems; label: string }[] = [
  { key: 'laptops', label: 'Laptops' },
  { key: 'phones', label: 'Phones' },
  { key: 'tablets', label: 'Tablets' },
  { key: 'allInOnes', label: 'All In Ones' },
  { key: 'desktops', label: 'Desktops' },
  { key: 'commsDevices', label: 'SIM Cards' },
  { key: 'broadbandHubs', label: 'Broadband Hubs' },
  { key: 'other', label: 'Other' },
];

/** One row of the "requested vs assigned" per-type breakdown shown while prepping. */
export interface TypeProgressRow {
  key: keyof DeviceRequestItems;
  label: string;
  requested: number;
  assigned: number;
}
