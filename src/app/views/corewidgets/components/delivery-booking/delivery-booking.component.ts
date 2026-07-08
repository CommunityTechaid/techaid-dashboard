import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { AppLocalCSS } from '../org-request/app-local-css.component';
import { BookingFlowComponent } from './booking-flow.component';

/**
 * Public device-delivery booking page. Presented as a standalone public page: the app
 * chrome (sidebar/header) is always hidden here via AppLocalCSS, so the "Delivery Booking
 * (Public-facing)" header link — which opens this in a new tab — shows just the booking
 * flow with no top/side nav, for staff and the public alike.
 *
 * When the delivery-booking feature flag is off, a banner marks it as a UAT-only preview
 * (the route guard already blocks it on production). The `--cta-*` design tokens are
 * scoped to :host so they don't leak into the dashboard.
 */
@Component({
  selector: 'app-delivery-booking',
  standalone: true,
  imports: [BookingFlowComponent, AppLocalCSS],
  templateUrl: './delivery-booking.component.html',
  styleUrl: './delivery-booking.component.scss',
})
export class DeliveryBookingComponent implements OnInit, OnDestroy {
  readonly showUatBanner = signal(false);
  private readonly sub = new Subscription();

  constructor(private readonly featureFlags: FeatureFlagService) {}

  ngOnInit(): void {
    this.sub.add(
      this.featureFlags.deliveryBookingVisibility().subscribe((state) => this.showUatBanner.set(!state.live)),
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
