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
