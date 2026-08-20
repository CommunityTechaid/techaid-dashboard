import { Component, computed, OnInit, signal } from '@angular/core';
import { BookingApiError, BookingApiService } from './booking-api.service';
import {
  DeliveryBookingConfirmation,
  DeliveryBookingInput,
  DeliveryDayAvailability,
} from './models';
import { DayStepComponent } from './day-step/day-step.component';
import { WindowStepComponent } from './window-step/window-step.component';
import { DetailsStepComponent, DetailsFormValue } from './details-step/details-step.component';
import { ConfirmationStepComponent } from './confirmation-step/confirmation-step.component';

type Step = 'day' | 'window' | 'details' | 'confirmation';

// The server's booking input has a single free-text `address` field, so the
// building/flat detail and postcode collected as separate form controls are folded
// into it here, in the order a reader expects: building detail, then street address,
// then postcode (skipped if `formatted_address` already ends with it).
function composeAddress(form: DetailsFormValue): string {
  const parts: string[] = [];
  if (form.buildingDetail.trim()) {
    parts.push(form.buildingDetail.trim());
  }
  const address = form.address.trim();
  parts.push(address);
  const postcode = form.postcode.trim();
  if (postcode) {
    const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, '');
    if (!normalise(address).endsWith(normalise(postcode))) {
      parts.push(postcode);
    }
  }
  return parts.join('\n');
}

const STEP_LABELS: Record<Exclude<Step, 'confirmation'>, string> = {
  day: 'Step 1 of 3 — Choose a day',
  window: 'Step 2 of 3 — Choose a window',
  details: 'Step 3 of 3 — Your details',
};

@Component({
  selector: 'app-booking-flow',
  standalone: true,
  imports: [DayStepComponent, WindowStepComponent, DetailsStepComponent, ConfirmationStepComponent],
  templateUrl: './booking-flow.component.html',
  styleUrl: './booking-flow.component.scss',
})
export class BookingFlowComponent implements OnInit {
  readonly step = signal<Step>('day');

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
      case 'day':
        return 1;
      case 'window':
        return 2;
      default:
        return 3;
    }
  });

  constructor(private readonly api: BookingApiService) {}

  ngOnInit(): void {
    this.loadAvailability();
  }

  loadAvailability(): void {
    this.loadingAvailability.set(true);
    this.availabilityError.set(null);
    this.api.getAvailability().subscribe({
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

  backToDay(): void {
    this.step.set('day');
  }

  backToWindow(): void {
    this.step.set('window');
  }

  submit(form: DetailsFormValue): void {
    const date = this.selectedDate();
    const windowId = this.selectedWindowId();
    if (!date || !windowId) {
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
      // The form control is a text input; the schema types this as Long!.
      ctaReference: Number(form.ctaReference),
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
