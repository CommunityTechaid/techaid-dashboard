import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { combineLatest, Subscription } from 'rxjs';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { WardLookupService } from '@app/shared/services/ward-lookup.service';

const DATA_QUERY = gql`
  query deliverySlotsAdmin {
    deliveryBookingsAdmin { id date dayLabel window { id name } firstName surname email phone address accessNotes ctaReference createdAt matchedRequestId matchedRequestStatus matchedRequestOpen }
  }
`;

const DELETE_BOOKING = gql`mutation deleteDeliveryBooking($id: ID!, $clearRequestDelivery: Boolean) { deleteDeliveryBooking(id: $id, clearRequestDelivery: $clearRequestDelivery) }`;

// Bookings don't carry the referring organisation, so the CSV export resolves it from the
// device request each booking's ctaReference points at. Only run when exporting — the
// table itself doesn't show Org, so making the page's initial load pay for it would be waste.
const EXPORT_ORGS_QUERY = gql`
  query deliveryExportOrgs($ids: [Long]) {
    deviceRequestConnection(page: { size: 500 }, where: { id: { _in: $ids } }) {
      content {
        id
        referringOrganisationContact {
          referringOrganisation { name }
        }
      }
    }
  }
`;

// Column order and header text must match the "TaDa Import" tab of the driver's Delivery
// Schedule spreadsheet exactly — see docs/poc_delivery_schedule_sync/README.md. The CSV this
// produces is byte-identical in shape to scripts/export-delivery-schedule.mjs.
// Access Notes sits in column J, leaving H and I empty, so a block of rows pasted into one of
// the weekly driver tabs lines up: there H is "Delivered (Y or N)", I is the follow-up call
// permission and J is "Notes". The two blanks are load-bearing - don't tidy them away.
const CSV_HEADERS = [
  'Date',
  'Req No.',
  'Distributions Only',
  'Name',
  'Org',
  'Address',
  'Telephone no.',
  '',
  '',
  'Access Notes',
];

// The server refuses to delete a booking while its linked request still shows a delivery as
// arranged — this is the exact enum value matchedRequestStatus arrives as (confirmed against the
// display label map in device-request-info.component.ts and the e2e fixture in
// delivery-slots-badges.spec.ts), not a display label.
const DELIVERY_ARRANGED_STATUS = 'PROCESSING_COLLECTION_DELIVERY_ARRANGED';

/** The sheet's Date column is UK-formatted, matching the weekly driver tabs. */
function toUkDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// UK postcode found anywhere in a free-text blob. Duplicated from details-step.component.ts's
// UK_POSTCODE_PATTERN (with the `g` flag added for matchAll) rather than pulled into a shared
// helper — there's no existing shared location for this kind of parsing, and this is the
// shorter diff. Global so every candidate in the address can be found; the LAST one is taken,
// since the postcode is conventionally last and a street name can contain postcode-like tokens.
const POSTCODE_PATTERN = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/gi;

function extractPostcode(address: string): string | null {
  const matches = address.match(POSTCODE_PATTERN);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
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
  ctaReference: number;
  createdAt?: string;
  matchedRequestId?: string;
  matchedRequestStatus?: string;
  matchedRequestOpen?: boolean;
  /** Resolved client-side after load, from the address's postcode — see resolveOutOfArea(). */
  outOfArea?: boolean;
}

interface BookingGroup {
  key: string;
  dayLabel: string;
  windowName: string;
  bookings: BookingRow[];
}

/**
 * Read-only view of who has booked each delivery slot. This used to also manage
 * enable/disable, delivery days, windows and blocked dates, but those settings moved to
 * Admin Panel → Delivery Configuration so every changeable setting sits behind the admin
 * panel's access boundary. Rendered as the "Delivery Slots" tab on the DnD page.
 */
@Component({
  selector: 'app-delivery-slots',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './delivery-slots.component.html',
  styleUrl: './delivery-slots.component.scss',
})
export class DeliverySlotsComponent implements OnInit, OnDestroy {
  loading = true;
  exporting = false;

  bookingGroups: BookingGroup[] = [];
  totalBookings = 0;

  /** Flat copy of what's on screen, kept in load order, so the export matches the table. */
  private allBookings: BookingRow[] = [];

  private readonly sub = new Subscription();

  constructor(
    private readonly apollo: Apollo,
    private readonly toastr: ToastrService,
    private readonly featureFlags: FeatureFlagService,
    private readonly wardLookup: WardLookupService,
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
    // Apollo v4 freezes query responses — copy each row so it isn't a frozen object.
    this.allBookings = bookings.map((b) => ({ ...b }));
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
      // Apollo v4 freezes query responses — copy each row so it isn't a frozen object.
      groups.get(key)!.bookings.push({ ...b });
    }
    this.bookingGroups = Array.from(groups.values());
    this.resolveOutOfArea();
  }

  /**
   * Flags bookings whose address's postcode doesn't resolve to a currently-supported borough,
   * for the "outside delivery area" chiclet. Resolved client-side rather than persisted at
   * booking time — see WardLookupService, whose lookup() call reuses a single cached asset
   * fetch, so this is one HTTP GET for the whole table regardless of row count, not one per
   * row. Silent (no chiclet, no warning) for a row with no extractable postcode.
   */
  private resolveOutOfArea(): void {
    const postcodes = new Set<string>();
    for (const group of this.bookingGroups) {
      for (const b of group.bookings) {
        const pc = extractPostcode(b.address ?? '');
        if (pc) postcodes.add(pc);
      }
    }
    if (postcodes.size === 0) {
      return;
    }
    const uniquePostcodes = Array.from(postcodes);

    this.sub.add(
      combineLatest([
        this.featureFlags.supportedBoroughs(),
        combineLatest(uniquePostcodes.map((pc) => this.wardLookup.lookup(pc))),
      ]).subscribe(([supported, results]) => {
        const outOfAreaPostcodes = new Set<string>();
        uniquePostcodes.forEach((pc, i) => {
          const result = results[i];
          const flagged =
            result.status === 'not-found' ||
            (result.status === 'resolved' && !supported.some((borough) => borough.code === result.borough.code));
          if (flagged) {
            outOfAreaPostcodes.add(pc);
          }
        });
        for (const group of this.bookingGroups) {
          for (const b of group.bookings) {
            const pc = extractPostcode(b.address ?? '');
            b.outOfArea = !!pc && outOfAreaPostcodes.has(pc);
          }
        }
      }),
    );
  }

  deleteBooking(bk: BookingRow, group: BookingGroup): void {
    if (
      !confirm(
        `Delete the booking for ${bk.firstName} ${bk.surname} (${bk.ctaReference}) on ${group.dayLabel}? This can't be undone and frees the slot.`,
      )
    ) {
      return;
    }

    let clearRequestDelivery = false;
    if (bk.matchedRequestStatus === DELIVERY_ARRANGED_STATUS) {
      if (
        !confirm(
          `Device request ${bk.matchedRequestId} still shows a delivery as arranged.\n\nOK — clear the delivery details from that request and delete the booking.\nCancel — leave everything as it is.`,
        )
      ) {
        return;
      }
      clearRequestDelivery = true;
    }

    this.apollo
      .mutate<any>({ mutation: DELETE_BOOKING, variables: { id: bk.id, clearRequestDelivery } })
      .subscribe({
        next: () => {
          group.bookings = group.bookings.filter((b) => b.id !== bk.id);
          this.totalBookings = Math.max(0, this.totalBookings - 1);
          if (group.bookings.length === 0) {
            this.bookingGroups = this.bookingGroups.filter((g) => g.key !== group.key);
          }
          this.toastr.success('Booking deleted');
        },
        error: (err) => {
          this.toastr.error(err?.message || 'Could not delete booking');
        },
      });
  }

  /**
   * Downloads what's currently on this page as a CSV in the column shape of the "TaDa Import"
   * tab of the driver's Delivery Schedule spreadsheet. Exports every booking the page has
   * loaded, past ones included — the page is the source of truth for what's exported, so
   * what you see is what you get; narrowing to a date range is left to the spreadsheet.
   */
  exportCsv(): void {
    if (this.exporting || this.allBookings.length === 0) {
      return;
    }
    this.exporting = true;

    const ids = Array.from(
      new Set(this.allBookings.map((b) => b.ctaReference).filter((r) => r !== null && r !== undefined)),
    );

    this.sub.add(
      this.apollo.query<any>({ query: EXPORT_ORGS_QUERY, variables: { ids }, fetchPolicy: 'network-only' }).subscribe({
        next: ({ data }) => {
          const orgById = new Map<string, string>();
          for (const req of data?.deviceRequestConnection?.content ?? []) {
            orgById.set(String(req.id), req.referringOrganisationContact?.referringOrganisation?.name ?? '');
          }
          this.downloadCsv(this.buildCsv(orgById));
          this.exporting = false;
        },
        error: () => {
          // A failed org lookup shouldn't cost the user the export — every other column is
          // already in hand, so fall back to blank Org rather than nothing at all.
          this.downloadCsv(this.buildCsv(new Map()));
          this.exporting = false;
          this.toastr.warning('Exported without organisation names — the lookup failed.');
        },
      }),
    );
  }

  private buildCsv(orgById: Map<string, string>): string {
    const rows = this.allBookings
      .slice()
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .map((b) => [
        toUkDate(b.date),
        b.ctaReference ?? '',
        // Every booking made through the public flow is a device delivery to a beneficiary,
        // which is what the driver's sheet calls a Distribution.
        'Distribution',
        [b.firstName, b.surname].filter(Boolean).join(' ').trim(),
        orgById.get(String(b.ctaReference)) ?? '',
        (b.address ?? '').trim(),
        b.phone ?? '',
        '',
        '',
        (b.accessNotes ?? '').trim(),
      ]);

    return [CSV_HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  private downloadCsv(csv: string): void {
    // The BOM makes Excel read it as UTF-8 rather than the local codepage.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `delivery-schedule-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
