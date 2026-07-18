import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subscription } from 'rxjs';

const DATA_QUERY = gql`
  query deliverySlotsAdmin {
    deliveryConfig { id enabled daysOfWeek leadTimeDays advanceDays updatedAt }
    deliveryWindowsAdmin { id name startTime endTime icon capacity sortOrder active }
    deliveryBlockedDates { id date reason }
    deliveryBookingsAdmin { id date dayLabel window { id name } firstName surname email phone address accessNotes ctaReference createdAt matchedRequestId matchedRequestStatus matchedRequestOpen }
  }
`;

const UPDATE_CONFIG = gql`
  mutation updateDeliveryConfig($data: UpdateDeliveryConfigInput!) {
    updateDeliveryConfig(data: $data) { id enabled daysOfWeek leadTimeDays advanceDays updatedAt }
  }
`;

const SAVE_WINDOW = gql`
  mutation saveDeliveryWindow($data: DeliveryWindowInput!) {
    saveDeliveryWindow(data: $data) { id name startTime endTime icon capacity sortOrder active }
  }
`;

const DELETE_WINDOW = gql`mutation deleteDeliveryWindow($id: ID!) { deleteDeliveryWindow(id: $id) }`;

const ADD_BLOCKED = gql`
  mutation addDeliveryBlockedDate($data: DeliveryBlockedDateInput!) {
    addDeliveryBlockedDate(data: $data) { id date reason }
  }
`;

const DELETE_BLOCKED = gql`mutation deleteDeliveryBlockedDate($id: ID!) { deleteDeliveryBlockedDate(id: $id) }`;

interface WindowRow {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  icon?: string;
  capacity: number;
  sortOrder?: number;
  active: boolean;
  saving?: boolean;
}

interface BlockedRow {
  id: string;
  date: string;
  reason?: string;
}

interface BookingRow {
  id: string;
  date: string;
  dayLabel: string;
  window?: { id: string; name: string };
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  address: string;
  accessNotes?: string;
  ctaReference: string;
  createdAt?: string;
  matchedRequestId?: string;
  matchedRequestStatus?: string;
  matchedRequestOpen?: boolean;
}

interface BookingGroup {
  key: string;
  dayLabel: string;
  windowName: string;
  bookings: BookingRow[];
}

const DAY_DEFS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
];

/**
 * Admin management for the public delivery-booking flow: enable/disable, which days
 * we deliver, the windows (times + capacity), blocked dates, and a read-only view of
 * who has booked each slot. Rendered as the "Delivery Slots" tab on the DnD page.
 */
@Component({
  selector: 'app-delivery-slots',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './delivery-slots.component.html',
  styleUrl: './delivery-slots.component.scss',
})
export class DeliverySlotsComponent implements OnInit, OnDestroy {
  readonly dayDefs = DAY_DEFS;

  loading = true;
  savingSettings = false;

  enabled = true;
  days: Record<number, boolean> = {};
  leadTimeDays = 1;
  advanceDays = 4;
  configUpdatedAt?: string;

  windows: WindowRow[] = [];
  blocked: BlockedRow[] = [];
  bookingGroups: BookingGroup[] = [];
  totalBookings = 0;

  newBlockedDate = '';
  newBlockedReason = '';

  private readonly sub = new Subscription();

  constructor(
    private readonly apollo: Apollo,
    private readonly toastr: ToastrService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.sub.add(
      this.apollo
        .query<any>({ query: DATA_QUERY, fetchPolicy: 'network-only' })
        .subscribe({
          next: ({ data }) => {
            const cfg = data.deliveryConfig;
            this.enabled = cfg?.enabled ?? true;
            this.leadTimeDays = cfg?.leadTimeDays ?? 1;
            this.advanceDays = cfg?.advanceDays ?? 4;
            this.configUpdatedAt = cfg?.updatedAt;
            this.days = {};
            (cfg?.daysOfWeek || '')
              .split(',')
              .map((s: string) => parseInt(s.trim(), 10))
              .filter((n: number) => n >= 1 && n <= 7)
              .forEach((n: number) => (this.days[n] = true));

            this.windows = (data.deliveryWindowsAdmin || []).map((w: any) => ({ ...w }));
            this.blocked = (data.deliveryBlockedDates || []).map((b: any) => ({ ...b }));
            this.groupBookings(data.deliveryBookingsAdmin || []);
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.toastr.error('Could not load delivery slot settings');
          },
        }),
    );
  }

  private groupBookings(bookings: BookingRow[]): void {
    this.totalBookings = bookings.length;
    const groups = new Map<string, BookingGroup>();
    for (const b of bookings) {
      const key = `${b.date}::${b.window?.id ?? '?'}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          dayLabel: b.dayLabel,
          windowName: b.window?.name ?? 'Unknown window',
          bookings: [],
        });
      }
      groups.get(key)!.bookings.push(b);
    }
    this.bookingGroups = Array.from(groups.values());
  }

  toggleDay(n: number): void {
    this.days[n] = !this.days[n];
  }

  private daysCsv(): string {
    return this.dayDefs
      .filter((d) => this.days[d.n])
      .map((d) => d.n)
      .join(',');
  }

  saveSettings(): void {
    this.savingSettings = true;
    this.apollo
      .mutate<any>({
        mutation: UPDATE_CONFIG,
        variables: {
          data: {
            enabled: this.enabled,
            daysOfWeek: this.daysCsv(),
            leadTimeDays: Number(this.leadTimeDays) || 0,
            advanceDays: Number(this.advanceDays) || 1,
          },
        },
      })
      .subscribe({
        next: ({ data }) => {
          this.configUpdatedAt = data.updateDeliveryConfig.updatedAt;
          this.savingSettings = false;
          this.toastr.success('Delivery settings saved');
        },
        error: () => {
          this.savingSettings = false;
          this.toastr.error('Could not save settings');
        },
      });
  }

  addWindow(): void {
    this.windows.push({
      name: '',
      startTime: '',
      endTime: '',
      icon: '🚚',
      capacity: 4,
      sortOrder: this.windows.length + 1,
      active: true,
    });
  }

  adjustCapacity(w: WindowRow, delta: number): void {
    w.capacity = Math.min(50, Math.max(0, (Number(w.capacity) || 0) + delta));
  }

  saveWindow(w: WindowRow): void {
    if (!w.name || !w.startTime || !w.endTime) {
      this.toastr.warning('A window needs a name, start time and end time');
      return;
    }
    w.saving = true;
    this.apollo
      .mutate<any>({
        mutation: SAVE_WINDOW,
        variables: {
          data: {
            id: w.id ?? null,
            name: w.name,
            startTime: w.startTime,
            endTime: w.endTime,
            icon: w.icon || null,
            capacity: Number(w.capacity) || 0,
            sortOrder: w.sortOrder ?? null,
            active: w.active,
          },
        },
      })
      .subscribe({
        next: ({ data }) => {
          Object.assign(w, data.saveDeliveryWindow, { saving: false });
          this.toastr.success(`Saved "${w.name}"`);
        },
        error: () => {
          w.saving = false;
          this.toastr.error('Could not save window');
        },
      });
  }

  deleteWindow(w: WindowRow, index: number): void {
    if (!w.id) {
      this.windows.splice(index, 1);
      return;
    }
    if (!confirm(`Delete "${w.name}"? This can't be undone.`)) {
      return;
    }
    this.apollo.mutate<any>({ mutation: DELETE_WINDOW, variables: { id: w.id } }).subscribe({
      next: () => {
        this.windows.splice(index, 1);
        this.toastr.success('Window deleted');
      },
      error: (err) => {
        this.toastr.error(err?.message || 'Could not delete window');
      },
    });
  }

  addBlocked(): void {
    if (!this.newBlockedDate) {
      this.toastr.warning('Pick a date to block');
      return;
    }
    this.apollo
      .mutate<any>({
        mutation: ADD_BLOCKED,
        variables: { data: { date: this.newBlockedDate, reason: this.newBlockedReason || null } },
      })
      .subscribe({
        next: ({ data }) => {
          const row = data.addDeliveryBlockedDate;
          const existing = this.blocked.findIndex((b) => b.id === row.id);
          if (existing >= 0) {
            this.blocked[existing] = row;
          } else {
            this.blocked = [...this.blocked, row].sort((a, b) => a.date.localeCompare(b.date));
          }
          this.newBlockedDate = '';
          this.newBlockedReason = '';
          this.toastr.success('Date blocked');
        },
        error: () => this.toastr.error('Could not block that date'),
      });
  }

  removeBlocked(b: BlockedRow, index: number): void {
    this.apollo.mutate<any>({ mutation: DELETE_BLOCKED, variables: { id: b.id } }).subscribe({
      next: () => {
        this.blocked.splice(index, 1);
        this.toastr.success('Date unblocked');
      },
      error: () => this.toastr.error('Could not remove that date'),
    });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
