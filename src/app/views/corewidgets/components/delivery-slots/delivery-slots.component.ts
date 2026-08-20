import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subscription } from 'rxjs';

const DATA_QUERY = gql`
  query deliverySlotsAdmin {
    deliveryBookingsAdmin { id date dayLabel window { id name } firstName surname email phone address accessNotes ctaReference createdAt matchedRequestId matchedRequestStatus matchedRequestOpen additionalBookingAllowed }
  }
`;

const DELETE_BOOKING = gql`mutation deleteDeliveryBooking($id: ID!, $clearRequestDelivery: Boolean) { deleteDeliveryBooking(id: $id, clearRequestDelivery: $clearRequestDelivery) }`;

const ALLOW_ADDITIONAL = gql`mutation allowAdditionalDeliveryBooking($ctaReference: Long!, $note: String) { allowAdditionalDeliveryBooking(ctaReference: $ctaReference, note: $note) }`;

// The server refuses to delete a booking while its linked request still shows a delivery as
// arranged — this is the exact enum value matchedRequestStatus arrives as (confirmed against the
// display label map in device-request-info.component.ts and the e2e fixture in
// delivery-slots-badges.spec.ts), not a display label.
const DELIVERY_ARRANGED_STATUS = 'PROCESSING_COLLECTION_DELIVERY_ARRANGED';

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
  additionalBookingAllowed: boolean;
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

  bookingGroups: BookingGroup[] = [];
  totalBookings = 0;

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
      // Apollo v4 freezes query responses — copy each row so it can later be mutated in place
      // (e.g. flipping additionalBookingAllowed) without throwing on a frozen object.
      groups.get(key)!.bookings.push({ ...b });
    }
    this.bookingGroups = Array.from(groups.values());
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

  allowAdditionalBooking(bk: BookingRow): void {
    if (
      !confirm(
        `Allow one further booking for CTA reference ${bk.ctaReference}? This grants a one-off exemption from the duplicate-booking check for this reference.`,
      )
    ) {
      return;
    }
    this.apollo
      .mutate<any>({ mutation: ALLOW_ADDITIONAL, variables: { ctaReference: bk.ctaReference } })
      .subscribe({
        next: () => {
          // The override is per reference, not per booking — flip every row sharing it.
          this.bookingGroups = this.bookingGroups.map((g) => ({
            ...g,
            bookings: g.bookings.map((b) =>
              b.ctaReference === bk.ctaReference ? { ...b, additionalBookingAllowed: true } : b,
            ),
          }));
          this.toastr.success('Another booking is now allowed for this reference');
        },
        error: (err) => {
          this.toastr.error(err?.message || 'Could not grant the exemption');
        },
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
