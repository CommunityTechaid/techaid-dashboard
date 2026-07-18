/**
 * Shapes mirror the techaid-server GraphQL schema for delivery bookings
 * (deliveryAvailabilityPublic / submitDeliveryBookingPublic) so BookingApiService
 * can talk to the real API without the components needing to know how it's fetched.
 */

export interface DeliveryWindow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  icon: string;
}

export interface DeliveryWindowAvailability {
  window: DeliveryWindow;
  spotsRemaining: number;
}

export interface DeliveryDayAvailability {
  /** ISO date, e.g. "2026-07-16" */
  date: string;
  dayOfWeek: string;
  dayLabel: string;
  windows: DeliveryWindowAvailability[];
}

export interface DeliveryBookingInput {
  date: string;
  windowId: string;
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  address: string;
  accessNotes?: string;
  ctaReference: string;
  turnstileToken?: string;
}

export interface DeliveryBookingConfirmation {
  id: string;
  date: string;
  dayLabel: string;
  window: DeliveryWindow;
  address: string;
  ctaReference: string;
  confirmationSentTo: string;
}
