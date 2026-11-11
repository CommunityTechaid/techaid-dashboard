import { Component, OnDestroy, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { Subscription } from 'rxjs';
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP } from '@app/shared/utils/device-types';

// Embedded as the "History" tab of the Admin Panel (issue #273, server contract techaid-server#327).

const SETTING_CHANGES = gql`
  query settingChanges($settingType: String, $settingKey: String, $page: Int, $size: Int) {
    settingChanges(settingType: $settingType, settingKey: $settingKey, page: $page, size: $size) {
      totalElements totalPages number size
      content {
        id changedAt source changedByEmail changedByName
        settingType settingKey subjectId subjectLabel field changeType oldValue newValue
      }
    }
  }
`;

interface SettingChange {
  id: string;
  changedAt: string;
  source: 'USER' | 'MIGRATION' | 'SYSTEM';
  changedByEmail: string | null;
  changedByName: string | null;
  settingType: string;
  settingKey: string;
  subjectId: string | null;
  subjectLabel: string | null;
  field: string;
  changeType: 'CREATED' | 'UPDATED' | 'DELETED';
  oldValue: string | null;
  newValue: string | null;
}

interface Page {
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  content: SettingChange[];
}

interface Row {
  id: string;
  changedAt: string;
  who: string;
  whoTitle: string | null;
  setting: string;
  change: string;
}

/** The server takes one settingType, so each type is its own option; '' = all. */
export const SETTING_TYPES = [
  { value: '', label: 'All' },
  { value: 'FEATURE_FLAG', label: 'Feature flags' },
  { value: 'BOROUGH_GROUP', label: 'Borough groups' },
  { value: 'BOROUGH_AVAILABILITY', label: 'Device availability' },
  { value: 'LIMIT_EXCEPTION', label: 'Limit exceptions' },
  { value: 'ADMIN_CONFIG', label: 'Admin config (public-request switches & membership)' },
  { value: 'DELIVERY_CONFIG', label: 'Delivery settings & days' },
  { value: 'DELIVERY_WINDOW', label: 'Delivery windows' },
  { value: 'DELIVERY_BLOCKED_DATE', label: 'Blocked delivery dates' },
  { value: 'DELIVERY_DAY_BOROUGH', label: 'Delivery day boroughs' },
];

// Labels as the Membership tab shows them.
const VALUE_LABELS: Record<string, string> = { true: 'On', false: 'Off', GRACE: 'Grace period', BLOCK: 'Hard block' };

const FIELD_LABELS: Record<string, string> = {
  maxPerReferee: 'limit per referrer',
  membershipOverLimitMode: 'over-limit mode',
  membershipGraceRequests: 'grace requests',
  // Delivery configuration.
  enabled: 'enabled',
  leadTimeDays: 'lead time (days)',
  advanceDays: 'delivery days offered ahead',
  boroughSchedulingEnabled: 'borough scheduling',
  startTime: 'start time',
  endTime: 'end time',
  sortOrder: 'sort order',
  active: 'active',
};

// ISO day-of-week numbers as stored by the server (1 = Monday .. 7 = Sunday).
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function days(v: string | null): string[] {
  return (v ?? '').split(',').filter((d) => d !== '').map((d) => DAY_NAMES[Number(d)] ?? d);
}

const PAGE_SIZE = 20;

function deviceLabel(key: string): string {
  const type = DEVICE_TYPES.find((t) => DEVICE_TYPE_LOOKUP[t.value] === key);
  return type ? type.label : key;
}

function settingOf(c: SettingChange): string {
  const label = c.subjectLabel || c.settingKey;
  switch (c.settingType) {
    case 'FEATURE_FLAG':
      return `Feature flag ${c.settingKey}`;
    case 'BOROUGH_GROUP':
      return `Borough group "${label}"`;
    case 'BOROUGH_AVAILABILITY':
      // settingKey is `groupId:deviceType`.
      return `Borough group "${label}" / ${deviceLabel(c.settingKey.split(':').pop() ?? '')}`;
    case 'LIMIT_EXCEPTION':
      return `Limit exception "${label}"`;
    case 'DELIVERY_CONFIG':
      return 'Delivery configuration';
    case 'DELIVERY_WINDOW':
      return `Delivery window "${label}"`;
    case 'DELIVERY_BLOCKED_DATE':
      return `Blocked delivery date ${label}`;
    case 'DELIVERY_DAY_BOROUGH':
      return `Boroughs delivered to on ${FULL_DAY_NAMES[Number(c.settingKey)] ?? c.settingKey}`;
    case 'ADMIN_CONFIG':
      return c.field.startsWith('membership') ? 'Membership settings' : 'Public request switches';
    default:
      return `${c.settingType} ${c.settingKey}`;
  }
}

/** Delivery rows with their own wording; null falls through to the generic "field: old → new". */
function deliveryChangeOf(c: SettingChange): string | null {
  switch (c.settingType) {
    case 'DELIVERY_CONFIG': {
      if (c.field !== 'daysOfWeek') return null;
      const before = days(c.oldValue);
      const after = days(c.newValue);
      const added = after.filter((d) => !before.includes(d));
      const removed = before.filter((d) => !after.includes(d));
      const notes = [
        ...(added.length ? [`added ${added.join(', ')}`] : []),
        ...(removed.length ? [`removed ${removed.join(', ')}`] : []),
      ];
      const suffix = notes.length ? ` (${notes.join('; ')})` : '';
      return `Delivery days: ${before.join(', ') || 'none'} → ${after.join(', ') || 'none'}${suffix}`;
    }
    case 'DELIVERY_BLOCKED_DATE':
      if (c.changeType === 'CREATED') return `Date blocked${c.newValue ? `: ${c.newValue}` : ''}`;
      if (c.changeType === 'DELETED') return 'Date unblocked';
      return `reason: ${c.oldValue || '(none)'} → ${c.newValue || '(none)'}`;
    case 'DELIVERY_DAY_BOROUGH': {
      const list = (v: string | null) => (v ? v.split(',').join(', ') : '(any borough)');
      const from = c.changeType === 'CREATED' ? null : c.oldValue;
      const to = c.changeType === 'DELETED' ? null : c.newValue;
      return `boroughs: ${list(from)} → ${list(to)}`;
    }
    default:
      return null;
  }
}

function changeOf(c: SettingChange): string {
  const delivery = deliveryChangeOf(c);
  if (delivery) return delivery;
  const field = c.field.startsWith('canPublicRequest')
    ? c.field.replace('canPublicRequest', '')
    : FIELD_LABELS[c.field] ?? c.field;
  const show = (v: string | null) => (v == null || v === '' ? '' : VALUE_LABELS[v] ?? v);
  const oldValue = c.changeType === 'CREATED' || c.oldValue == null ? '(created)' : show(c.oldValue);
  const newValue = c.changeType === 'DELETED' ? '(deleted)' : show(c.newValue);
  return `${field}: ${oldValue} → ${newValue}`;
}

@Component({
  selector: 'app-settings-history',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './settings-history.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SettingsHistoryComponent implements OnInit, OnDestroy {
  readonly types = SETTING_TYPES;
  settingType = '';
  settingKey = '';
  rows: Row[] = [];
  page = 0;
  totalPages = 0;
  loading = true;
  failed = false;
  private sub?: Subscription;
  // Written from Apollo callbacks: mark for check so the view repaints without zone.js (#115).
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(private readonly apollo: Apollo) {}

  ngOnInit(): void {
    this.load(0);
  }

  load(page: number): void {
    this.loading = true;
    this.failed = false;
    this.sub?.unsubscribe();
    this.sub = this.apollo
      .query<{ settingChanges: Page }>({
        query: SETTING_CHANGES,
        fetchPolicy: 'network-only',
        variables: {
          settingType: this.settingType || null,
          settingKey: this.settingKey.trim() || null,
          page,
          size: PAGE_SIZE,
        },
      })
      .subscribe({
        next: ({ data, error }) => {
          this.cdr.markForCheck();
          this.loading = false;
          if (error || !data?.settingChanges) {
            this.failed = true;
            return;
          }
          const result = data.settingChanges;
          this.page = result.number;
          this.totalPages = result.totalPages;
          // Apollo responses are frozen: build new row objects, never mutate.
          this.rows = result.content.map((c) => ({
            id: c.id,
            changedAt: c.changedAt,
            who: c.source === 'USER' ? c.changedByName || c.changedByEmail || 'Unknown user' : 'System',
            whoTitle: c.source === 'USER' ? c.changedByEmail : null,
            setting: settingOf(c),
            change: changeOf(c),
          }));
        },
        error: () => {
          this.cdr.markForCheck();
          this.loading = false;
          this.failed = true;
        },
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
