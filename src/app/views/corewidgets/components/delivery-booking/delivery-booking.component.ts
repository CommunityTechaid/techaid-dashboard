import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { AppLocalCSS } from '../org-request/app-local-css.component';
import { BookingFlowComponent } from './booking-flow.component';

/**
 * Public device-delivery booking page, hosted inside the dashboard.
 *
 * - For anonymous visitors the app chrome (sidebar/header) is hidden via AppLocalCSS —
 *   the same trick the public org-request page uses — so the public link is clean.
 *   Logged-in staff previewing it keep the chrome.
 * - When the delivery-booking feature flag is off, a banner makes clear the page is a
 *   UAT preview and not live on production (the route guard already blocks it on prod).
 * - The `--cta-*` design tokens are scoped to :host so they don't leak into the dashboard.
 */
@Component({
  selector: 'app-delivery-booking',
  standalone: true,
  imports: [BookingFlowComponent, AppLocalCSS],
  templateUrl: './delivery-booking.component.html',
  styleUrl: './delivery-booking.component.scss',
})
export class DeliveryBookingComponent implements OnInit, OnDestroy {
  readonly hideChrome = signal(true);
  readonly showUatBanner = signal(false);

  @Select(UserState.user) user$: Observable<User>;
  private readonly sub = new Subscription();

  constructor(private readonly featureFlags: FeatureFlagService) {}

  ngOnInit(): void {
    this.sub.add(this.user$.subscribe((user) => this.hideChrome.set(!(user && user.authenticated))));
    this.sub.add(
      this.featureFlags.deliveryBookingVisibility().subscribe((state) => this.showUatBanner.set(!state.live)),
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
