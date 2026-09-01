import { Component, computed, signal } from '@angular/core';
import { BookingApiError, BookingApiService } from './booking-api.service';
import {
  DeliveryBookingConfirmation,
  DeliveryBookingInput,
  DeliveryDayAvailability,
} from './models';
import { ReferenceStepComponent } from './reference-step/reference-step.component';
import { DayStepComponent } from './day-step/day-step.component';
import { WindowStepComponent } from './window-step/window-step.component';
import { DetailsStepComponent, DetailsFormValue } from './details-step/details-step.component';
import { ConfirmationStepComponent } from './confirmation-step/confirmation-step.component';

type Step = 'reference' | 'day' | 'window' | 'details' | 'confirmation';

// The server's booking input has a single free-text `address` field, so the building/flat
// detail, the two address lines and the postcode collected as separate form controls are
// folded into it here, in the order a reader expects: building detail, address lines, then
// postcode (skipped if the last line already ends with it).
function composeAddress(form: DetailsFormValue): string {
  const parts: string[] = [];
  if (form.buildingDetail.trim()) {
    parts.push(form.buildingDetail.trim());
  }
  parts.push(form.addressLine1.trim());
  if (form.addressLine2.trim()) {
    parts.push(form.addressLine2.trim());
  }
  const postcode = form.postcode.trim();
  if (postcode) {
    const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, '');
    const lastLine = parts[parts.length - 1] ?? '';
    if (!normalise(lastLine).endsWith(normalise(postcode))) {
      parts.push(postcode);
    }
  }
  return parts.join('\n');
}

const STEP_LABELS: Record<Exclude<Step, 'confirmation'>, string> = {
  reference: 'Step 1 of 4 — Your request ID',
  day: 'Step 2 of 4 — Choose a day',
  window: 'Step 3 of 4 — Choose a window',
  details: 'Step 4 of 4 — Your details',
};

@Component({
  selector: 'app-booking-flow',
  standalone: true,
  imports: [
    ReferenceStepComponent,
    DayStepComponent,
    WindowStepComponent,
    DetailsStepComponent,
    ConfirmationStepComponent,
  ],
  templateUrl: './booking-flow.component.html',
  styleUrl: './booking-flow.component.scss',
})
export class BookingFlowComponent {
  readonly step = signal<Step>('reference');

  readonly ctaReference = signal<number | null>(null);
  readonly checkingReference = signal(false);
  readonly referenceError = signal<string | null>(null);

  readonly availability = signal<DeliveryDayAvailability[] | null>(null);
  readonly loadingAvailability = signal(true);
  readonly availabilityError = signal<string | null>(null);

  readonly selectedDate = signal<string | null>(null);
  readonly selectedWindowId = signal<string | null>(null);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly confirmation = signal<DeliveryBookingConfirmation | null>(null);

  readonly selectedDay = computed<DeliveryDayAvailability | null>(() => {
    const date = this.selectedDate();
    return this.availability()?.find((d) => d.date === date) ?? null;
  });

  readonly selectedWindow = computed(() => {
    const day = this.selectedDay();
    const windowId = this.selectedWindowId();
    return day?.windows.find((w) => w.window.id === windowId)?.window ?? null;
  });

  readonly stepLabel = computed(() => {
    const step = this.step();
    return step === 'confirmation' ? '' : STEP_LABELS[step];
  });

  readonly stepIndex = computed(() => {
    switch (this.step()) {
      case 'reference':
        return 1;
      case 'day':
        return 2;
      case 'window':
        return 3;
      default:
        return 4;
    }
  });

  constructor(private readonly api: BookingApiService) {}

  submitReference(ref: number): void {
    this.checkingReference.set(true);
    this.referenceError.set(null);
    this.api.checkEligibility(ref).subscribe({
      next: (result) => {
        this.checkingReference.set(false);
        if (result.eligible) {
          this.ctaReference.set(ref);
          this.step.set('day');
          this.loadAvailability();
        } else {
          this.referenceError.set(result.message ?? 'This request isn’t eligible to book a delivery yet.');
        }
      },
      error: () => {
        // Network/transport failure — let them through. The server re-applies the
        // identical eligibility check at submit time, so a transient failure here
        // must not block a legitimate booking.
        this.checkingReference.set(false);
        this.ctaReference.set(ref);
        this.step.set('day');
        this.loadAvailability();
      },
    });
  }

  loadAvailability(): void {
    this.loadingAvailability.set(true);
    this.availabilityError.set(null);
    this.api.getAvailability(this.ctaReference()).subscribe({
      next: (days) => {
        this.availability.set(days);
        this.loadingAvailability.set(false);
      },
      error: () => {
        this.availabilityError.set('We couldn’t load delivery availability. Please try again shortly.');
        this.loadingAvailability.set(false);
      },
    });
  }

  selectDay(date: string): void {
    this.selectedDate.set(date);
    this.selectedWindowId.set(null);
    this.step.set('window');
  }

  selectWindow(windowId: string): void {
    this.selectedWindowId.set(windowId);
    this.step.set('details');
  }

  backToReference(): void {
    this.selectedDate.set(null);
    this.selectedWindowId.set(null);
    this.availability.set(null);
    this.step.set('reference');
  }

  backToDay(): void {
    this.step.set('day');
  }

  backToWindow(): void {
    this.step.set('window');
  }

  submit(form: DetailsFormValue): void {
    const date = this.selectedDate();
    const windowId = this.selectedWindowId();
    const ctaReference = this.ctaReference();
    if (!date || !windowId || ctaReference === null) {
      return;
    }

    const input: DeliveryBookingInput = {
      date,
      windowId,
      firstName: form.firstName,
      surname: form.surname,
      email: form.email,
      phone: form.phone,
      address: composeAddress(form),
      accessNotes: form.accessNotes || undefined,
      ctaReference,
      turnstileToken: form.turnstileToken || undefined,
    };

    this.submitting.set(true);
    this.submitError.set(null);

    this.api.submitBooking(input).subscribe({
      next: (confirmation) => {
        this.submitting.set(false);
        this.confirmation.set(confirmation);
        this.step.set('confirmation');
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        if (err instanceof BookingApiError && err.classification === 'BAD_REQUEST') {
          this.submitError.set(err.message);
        } else {
          this.submitError.set('Something went wrong booking your delivery. Please try again.');
        }
      },
    });
  }
}
