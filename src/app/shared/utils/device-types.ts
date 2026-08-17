export interface DeviceType {
  value: string;
  label: string;
}

export const DEVICE_TYPES: DeviceType[] = [
  { value: 'LAPTOPS', label: 'Laptops' },
  { value: 'PHONES', label: 'Phones' },
  { value: 'TABLETS', label: 'Tablets' },
  { value: 'ALLINONES', label: 'All In Ones' },
  { value: 'DESKTOPS', label: 'Desktops' },
  { value: 'COMMSDEVICES', label: 'SIM Cards' },
  { value: 'BROADBANDHUBS', label: 'Broadband Hubs' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * The device types the public request form can actually offer.
 *
 * A type only reaches a referrer if Application Configuration has a global switch for it
 * (`canPublicRequestLaptop` and friends). There are six of those, and `allInOnes` and `other` are
 * not among them — org-request.ts never puts either into the public device list, whatever else
 * says otherwise. Showing them in the borough matrix therefore offered an admin two controls that
 * silently did nothing.
 *
 * Deliberately NOT a trimmed DEVICE_TYPES: that list still needs all eight, because the admin
 * request-list filters match historical records and requests were raised for all-in-ones and
 * "other" long before this matrix existed. Same reasoning as CORE_BOROUGHS vs ALL_BOROUGHS in
 * boroughs.ts — what we offer today and what we have to be able to display are different questions.
 */
export const OFFERABLE_DEVICE_TYPES: DeviceType[] = DEVICE_TYPES.filter(
  (type) => !['ALLINONES', 'OTHER'].includes(type.value),
);

export const DEVICE_TYPE_LOOKUP: Record<string, string> = {
  'LAPTOPS': 'laptops',
  'PHONES': 'phones',
  'TABLETS': 'tablets',
  'ALLINONES': 'allInOnes',
  'DESKTOPS': 'desktops',
  'COMMSDEVICES': 'commsDevices',
  'BROADBANDHUBS': 'broadbandHubs',
  'OTHER': 'other',
};

export function getDeviceTypeLabel(value: string): string {
  const type = DEVICE_TYPES.find(t => t.value === value);
  return type ? type.label : value;
}

export const KIT_TYPES: DeviceType[] = [
  { value: 'LAPTOP', label: 'Laptop' },
  { value: 'TABLET', label: 'Tablet' },
  { value: 'SMARTPHONE', label: 'Smart Phone' },
  { value: 'ALLINONE', label: 'All In One (PC)' },
  { value: 'DESKTOP', label: 'Desktop' },
  { value: 'COMMSDEVICE', label: 'SIM Card' },
  { value: 'BROADBANDHUB', label: 'Broadband Hub' },
  { value: 'OTHER', label: 'Other' },
];

export function getKitTypeLabel(value: string): string {
  const type = KIT_TYPES.find(t => t.value === value);
  return type ? type.label : value;
}
