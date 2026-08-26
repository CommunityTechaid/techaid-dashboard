import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { combineLatest } from 'rxjs';
import { ConfigService } from '@app/shared/services/config.service';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { WardLookupService } from '@app/shared/services/ward-lookup.service';
import { DeliveryDayAvailability, DeliveryWindow } from '../models';
import { PlaceAutocompleteDirective, PlaceSelectedEvent } from '../place-autocomplete.directive';
import { TurnstileService } from '../turnstile.service';

export interface DetailsFormValue {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  buildingDetail: string;
  address: string;
  postcode: string;
  accessNotes: string;
  turnstileToken?: string;
}

// Accepts standard UK postcode formats with or without the internal space, case-insensitively;
// normalisePostcode() below re-inserts the space and uppercases on blur/auto-fill.
const UK_POSTCODE_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function normalisePostcode(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

// Angular's Validators.email accepts non-addresses like "A@B" — this pattern additionally
// requires a domain with a dot and a real (2+ char) final label, e.g. "example.com".
const EMAIL_DOMAIN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Strip the punctuation callers commonly type (spaces, hyphens, brackets) before
// checking the digit string. Kept separate from the validator so it's easy to reason about.
function stripPhoneFormatting(raw: string): string {
  return raw.replace(/[\s\-()]/g, '');
}

// Accepts UK numbers as "0" + 10 digits (11 digits total, e.g. 020 3488 7742,
// 07700 900123) or the equivalent international form "+44"/"0044" + 9-10 digits
// (the UK trunk "0" is dropped in international dialling).
function ukPhoneValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value ?? '').toString().trim();
  if (!value) {
    return null;
  }
  const stripped = stripPhoneFormatting(value);
  const valid = /^0\d{10}$/.test(stripped) || /^(\+44|0044)\d{9,10}$/.test(stripped);
  return valid ? null : { ukPhone: true };
}

@Component({
  selector: 'app-details-step',
  standalone: true,
  imports: [ReactiveFormsModule, PlaceAutocompleteDirective],
  templateUrl: './details-step.component.html',
  styleUrl: './details-step.component.scss',
})
export class DetailsStepComponent implements AfterViewInit, OnChanges {
  @Input() day: DeliveryDayAvailability | null = null;
  @Input() window: DeliveryWindow | null = null;
  @Input() ctaReference: number | null = null;
  @Input() submitting = false;
  @Input() submitError: string | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<DetailsFormValue>();

  @ViewChild('turnstileHost') turnstileHost?: ElementRef<HTMLElement>;

  private readonly fb = inject(FormBuilder);
  private readonly config = inject(ConfigService);
  private readonly turnstile = inject(TurnstileService);
  private readonly wardLookup = inject(WardLookupService);
  private readonly featureFlags = inject(FeatureFlagService);

  /**
   * Advisory only — never a hard block. The authoritative check is server-side against the
   * linked request's own borough, because a delivery address can legitimately differ from the
   * applicant's borough (staying with family, a workplace drop). A lookup miss, an unknown
   * postcode, or a covered borough all show nothing.
   */
  boroughWarning: string | null = null;

  readonly siteKey = (this.config.environment.turnstile_site_key ?? '').trim();
  readonly turnstileToken = signal<string | null>(null);
  readonly verificationPending = signal(false);

  private widgetId: string | null = null;

  readonly form = this.fb.nonNullable.group({
    firstName: ['', Validators.required],
    surname: ['', Validators.required],
    email: ['', [Validators.required, Validators.email, Validators.pattern(EMAIL_DOMAIN_PATTERN)]],
    phone: ['', [Validators.required, ukPhoneValidator]],
    buildingDetail: ['', Validators.maxLength(100)],
    address: ['', [Validators.required, Validators.maxLength(250)]],
    postcode: ['', [Validators.required, Validators.pattern(UK_POSTCODE_PATTERN)]],
    accessNotes: ['', Validators.maxLength(500)],
  });

  get summarySlot(): string {
    return this.window ? `${this.window.name} · ${this.window.startTime} – ${this.window.endTime}` : '';
  }

  ngAfterViewInit(): void {
    if (!this.siteKey || !this.turnstileHost) {
      return;
    }
    this.turnstile
      .load()
      .then(() => {
        if (!this.turnstileHost) {
          return;
        }
        this.widgetId = this.turnstile.render(
          this.turnstileHost.nativeElement,
          this.siteKey,
          (token) => {
            this.turnstileToken.set(token);
            this.verificationPending.set(false);
          },
          () => {
            // Turnstile tokens are single-use and expire — drop the stale one.
            this.turnstileToken.set(null);
          },
        );
      })
      .catch(() => {
        // If the script can't load we leave the token null; the submit guard will
        // surface a friendly "verifying" message rather than emitting an invalid booking.
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['submitError'];
    // Turnstile tokens are single-use. Whenever the parent surfaces a new submit
    // error, reset the widget and clear the stored token so the next attempt uses a
    // fresh one — otherwise every retry after a duplicate/validation error would fail.
    if (change && !change.firstChange && change.currentValue && !change.previousValue) {
      this.resetTurnstile();
    }
  }

  private resetTurnstile(): void {
    if (this.widgetId) {
      this.turnstile.reset(this.widgetId);
    }
    this.turnstileToken.set(null);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.siteKey && !this.turnstileToken()) {
      this.verificationPending.set(true);
      return;
    }
    const value: DetailsFormValue = {
      ...this.form.getRawValue(),
      turnstileToken: this.turnstileToken() ?? undefined,
    };
    this.submitted.emit(value);
  }

  onPlaceSelected(event: PlaceSelectedEvent): void {
    // Auto-fill only — the postcode control stays editable so the lookup missing a
    // postcode (or getting it wrong) never blocks or locks the field.
    if (event.postcode) {
      this.form.controls.postcode.setValue(normalisePostcode(event.postcode));
      this.checkBorough(this.form.controls.postcode.value);
    }
  }

  onPostcodeBlur(): void {
    const control = this.form.controls.postcode;
    if (control.value) {
      control.setValue(normalisePostcode(control.value));
    }
    this.checkBorough(control.value);
  }

  /**
   * Resolves the postcode's borough via the existing (lazily-loaded) ward lookup, and warns —
   * but never blocks — if it isn't one we currently cover. Reuses WardLookupService and
   * FeatureFlagService as-is rather than re-parsing the lookup table here.
   */
  private checkBorough(postcode: string): void {
    if (!WardLookupService.isWellFormed(postcode)) {
      this.boroughWarning = null;
      return;
    }
    combineLatest([this.wardLookup.lookup(postcode), this.featureFlags.supportedBoroughs()]).subscribe(
      ([result, supported]) => {
        if (result.status !== 'resolved') {
          this.boroughWarning = null;
          return;
        }
        const covered = supported.some((b) => b.code === result.borough.code);
        this.boroughWarning = covered
          ? null
          : `We don't usually deliver to ${result.borough.name}. You can still book, but please call us on 020 3488 7742 first so we can check we can reach you.`;
      },
    );
  }

  invalid(control: string): boolean {
    const c = this.form.get(control);
    return !!c && c.invalid && c.touched;
  }

  hasError(control: string, error: string): boolean {
    const c = this.form.get(control);
    return !!c && c.touched && c.hasError(error);
  }
}
