import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subscription, catchError, concatMap, from, map, of } from 'rxjs';

const DATA_QUERY = gql`
  query deliveryConfigAdmin {
    deliveryConfig { id enabled daysOfWeek leadTimeDays advanceDays updatedAt }
    deliveryWindowsAdmin { id name startTime endTime icon capacity sortOrder active }
    deliveryBlockedDates { id date reason }
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
  /** 24-hour `HH:mm`, as edited by the <input type="time"> — see toDisplayTime/fromDisplayTime. */
  startTime: string;
  endTime: string;
  icon?: string;
  capacity: number;
  sortOrder?: number;
  active: boolean;
  saving?: boolean;
  /** Original stored value when it couldn't be parsed as a time; startTime/endTime stay '' instead. */
  startTimeRaw?: string;
  endTimeRaw?: string;
  saveError?: string;
  saveErrorKind?: 'validation' | 'error';
  /** Serialised state as last loaded/saved from the server; compared against to derive dirtiness. */
  snapshot?: string;
}

/**
 * The server stores DeliveryWindow.startTime/endTime as varchar in a display format like
 * '2:00pm' — DeliveryCalendarInvite.kt parses that exact `h:mma` shape to build the .ics
 * calendar attachment, and DeliveryService.markCollectionDeliveryArranged parses it to set a
 * device request's collectionDate. Writing anything else silently breaks both. These converters
 * are the only place that format is produced or consumed on this side.
 */

/** '2:00pm' → '14:00', for the <input type="time"> control. Null when the stored value doesn't parse. */
function fromDisplayTime(display: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec((display || '').trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2];
  const meridiem = m[3].toLowerCase();
  if (hour < 1 || hour > 12) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/** '14:00' → '2:00pm' — lowercase meridiem, no leading zero, matching the seeded server format exactly. */
function toDisplayTime(time24: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time24 || '');
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2];
  const meridiem = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute}${meridiem}`;
}

interface BlockedRow {
  id: string;
  date: string;
  reason?: string;
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
 * Admin management for the public delivery-booking flow: enable/disable, which days we
 * deliver, the windows (times + capacity), and blocked dates. Presented as sub-tabs on the
 * "Delivery Configuration" tab of the Admin Panel, moved here from the Delivery Slots tab so
 * every changeable setting sits behind the admin panel's access boundary. The read-only
 * "Who's booked" view stayed behind on the Delivery Slots tab.
 *
 * Delivery windows are only persisted by their own per-row Save (or "Save all windows") — never
 * by the Booking Settings save button, which is a separate mutation. Window times round-trip
 * through fromDisplayTime/toDisplayTime because the server stores them as display-format varchar
 * that other server code parses (see the comment above those functions).
 */
@Component({
  selector: 'app-delivery-configuration',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './delivery-configuration.component.html',
  styleUrl: './delivery-configuration.component.scss',
})
export class DeliveryConfigurationComponent implements OnInit, OnDestroy {
  readonly dayDefs = DAY_DEFS;

  activeSection: 'settings' | 'windows' | 'blocked' = 'settings';

  loading = true;
  savingSettings = false;
  savingAllWindows = false;

  enabled = true;
  days: Record<number, boolean> = {};
  leadTimeDays = 1;
  advanceDays = 4;
  configUpdatedAt?: string;

  windows: WindowRow[] = [];
  blocked: BlockedRow[] = [];

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

  /**
   * Switch sub-tabs, confirming first if it would throw away unsaved window edits — mirrors
   * admin-panel.component.ts's selectTab() guard for the same reason: nothing here is
   * auto-saved, and a silent tab switch is how staff lost window edits in the first place.
   */
  selectSection(section: 'settings' | 'windows' | 'blocked'): void {
    if (this.activeSection === 'windows' && section !== 'windows' && this.windowsDirty) {
      const unsaved = this.dirtyWindowsCount;
      const confirmed = window.confirm(
        `You have ${unsaved} unsaved change${unsaved === 1 ? '' : 's'}.\n\n` +
          'Leaving this tab discards them. Continue?',
      );
      if (!confirmed) return;
    }
    this.activeSection = section;
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

            this.windows = (data.deliveryWindowsAdmin || []).map((w: any) => this.toRow(w));
            this.blocked = (data.deliveryBlockedDates || []).map((b: any) => ({ ...b }));
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.toastr.error('Could not load delivery slot settings');
          },
        }),
    );
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

  /** A row that has never been saved is always dirty; a saved row is dirty when it differs from its snapshot. */
  isDirty(w: WindowRow): boolean {
    if (!w.id) return true;
    return this.snapshotOf(w) !== w.snapshot;
  }

  get windowsDirty(): boolean {
    return this.windows.some((w) => this.isDirty(w));
  }

  get dirtyWindowsCount(): number {
    return this.windows.filter((w) => this.isDirty(w)).length;
  }

  private snapshotOf(w: WindowRow): string {
    return JSON.stringify({
      name: w.name,
      startTime: w.startTime,
      endTime: w.endTime,
      icon: w.icon,
      capacity: w.capacity,
      sortOrder: w.sortOrder,
      active: w.active,
    });
  }

  private toRow(w: any): WindowRow {
    const start = fromDisplayTime(w.startTime);
    const end = fromDisplayTime(w.endTime);
    const row: WindowRow = {
      id: w.id,
      name: w.name,
      startTime: start ?? '',
      endTime: end ?? '',
      icon: w.icon,
      capacity: w.capacity,
      sortOrder: w.sortOrder,
      active: w.active,
      startTimeRaw: start === null ? w.startTime : undefined,
      endTimeRaw: end === null ? w.endTime : undefined,
    };
    row.snapshot = this.snapshotOf(row);
    return row;
  }

  saveWindow(w: WindowRow): void {
    this.saveWindowRequest(w).subscribe((ok) => {
      if (ok) {
        this.toastr.success(`Saved "${w.name}"`);
      } else if (w.saveErrorKind === 'validation') {
        this.toastr.warning(w.saveError);
      } else {
        this.toastr.error(w.saveError || 'Could not save window');
      }
    });
  }

  /**
   * Saves every dirty window one at a time (concatMap, not a parallel burst) and reports a
   * single summary toast. A row that fails keeps its own inline error and stays dirty, so the
   * count on the button never falsely reaches zero.
   */
  saveAllWindows(): void {
    const dirty = this.windows.filter((w) => this.isDirty(w));
    if (dirty.length === 0 || this.savingAllWindows) return;
    this.savingAllWindows = true;
    let succeeded = 0;
    let failed = 0;
    from(dirty)
      .pipe(concatMap((w) => this.saveWindowRequest(w)))
      .subscribe({
        next: (ok) => (ok ? succeeded++ : failed++),
        complete: () => {
          this.savingAllWindows = false;
          if (failed === 0) {
            this.toastr.success(`Saved ${succeeded} window${succeeded === 1 ? '' : 's'}`);
          } else {
            this.toastr.error(`Saved ${succeeded}, ${failed} failed — see the window${failed === 1 ? '' : 's'} below`);
          }
        },
      });
  }

  /** Core save for one row, shared by saveWindow and saveAllWindows. Never toasts — callers decide how to report. */
  private saveWindowRequest(w: WindowRow) {
    w.saveError = undefined;
    w.saveErrorKind = undefined;
    const startDisplay = toDisplayTime(w.startTime);
    const endDisplay = toDisplayTime(w.endTime);
    if (!w.name || !startDisplay || !endDisplay) {
      w.saveError = 'A window needs a name, start time and end time';
      w.saveErrorKind = 'validation';
      return of(false);
    }
    w.saving = true;
    return this.apollo
      .mutate<any>({
        mutation: SAVE_WINDOW,
        variables: {
          data: {
            id: w.id ?? null,
            name: w.name,
            startTime: startDisplay,
            endTime: endDisplay,
            icon: w.icon || null,
            capacity: Number(w.capacity) || 0,
            sortOrder: w.sortOrder ?? null,
            active: w.active,
          },
        },
      })
      .pipe(
        map(({ data }) => {
          const saved = data.saveDeliveryWindow;
          const start = fromDisplayTime(saved.startTime);
          const end = fromDisplayTime(saved.endTime);
          Object.assign(w, saved, {
            startTime: start ?? w.startTime,
            endTime: end ?? w.endTime,
            startTimeRaw: start === null ? saved.startTime : undefined,
            endTimeRaw: end === null ? saved.endTime : undefined,
            saving: false,
          });
          w.snapshot = this.snapshotOf(w);
          return true;
        }),
        catchError((err) => {
          w.saving = false;
          w.saveError = err?.message || 'Could not save window';
          w.saveErrorKind = 'error';
          return of(false);
        }),
      );
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
