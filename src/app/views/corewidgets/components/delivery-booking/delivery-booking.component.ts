import { Component } from '@angular/core';
import { BookingFlowComponent } from './booking-flow.component';

/**
 * Public device-delivery booking page, hosted inside the dashboard so it can be
 * previewed in UAT. Routed with no AuthGuard — see core-widgets.routes.ts. The
 * `--cta-*` design tokens the booking UI needs are scoped to this component's :host
 * (custom properties inherit into the child components) so they don't leak into the
 * rest of the dashboard.
 */
@Component({
  selector: 'app-delivery-booking',
  standalone: true,
  imports: [BookingFlowComponent],
  templateUrl: './delivery-booking.component.html',
  styleUrl: './delivery-booking.component.scss',
})
export class DeliveryBookingComponent {}
