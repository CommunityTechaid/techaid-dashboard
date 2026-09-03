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
  addressLine1: string;
  addressLine2: string;
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

// Matches a UK postcode anywhere in a line so it can be stripped out of the address lines —
// Google folds it into the locality part ("London SW1A 2AA") and it has its own field here.
const POSTCODE_IN_TEXT = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

const ADDRESS_LINE_MAX = 150;

// Shown for any postcode that doesn't resolve to one of our supported boroughs — whether it's
// a known-but-unsupported borough (e.g. Tower Hamlets with the flag off) or simply absent from
// the lookup table (out of area, or newer than the table's edition). Advisory only; see
// boroughWarning below.
const OUT_OF_AREA_WARNING =
  "NOTE: You are entering an address outside of our supported areas. This may lead to delays and possible cancellation of your request. Please call us on 020 3488 7742 if you're unsure.";

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
   * applicant's borough (staying with family, a workplace drop). A covered borough, or an
   * incomplete/malformed postcode the user is still typing, shows nothing; a resolved-but-
   * unsupported borough and a well-formed postcode the lookup table has no record of (out of
   * area, or newer than the table's edition) both warn — see checkBorough().
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
    addressLine1: ['', [Validators.required, Validators.maxLength(150)]],
    addressLine2: ['', Validators.maxLength(150)],
    postcode: ['', [Validators.required, Validators.pattern(UK_POSTCODE_PATTERN)]],
    accessNotes: ['', Validators.maxLength(500)],
  });

  // Deliberately omits the window's `name` — internal slot labels like "10 - 4" duplicate
  // the times they sit next to and read as noise to the person booking.
  get summarySlot(): string {
    return this.window ? `${this.window.startTime} – ${this.window.endTime}` : '';
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
    // The directive has already written the whole formatted address into line 1; re-split it
    // across the two lines before anything else reads it.
    this.applyPlaceToAddressLines(event.formattedAddress);

    // Auto-fill only — the postcode control stays editable so the lookup missing a
    // postcode (or getting it wrong) never blocks or locks the field.
    if (event.postcode) {
      this.form.controls.postcode.setValue(normalisePostcode(event.postcode));
      this.checkBorough(this.form.controls.postcode.value);
    }
  }

  /**
   * Google hands back a single formatted address — "10 Downing St, London SW1A 2AA, UK" —
   * so the two address lines are derived from it: the first comma-separated part becomes
   * line 1 and the rest line 2, with the country and the postcode dropped. The postcode has
   * its own field, and repeating it inside the address reads as a mistake to the person
   * booking. Free typing is untouched; this only runs on an explicit suggestion pick.
   */
  private applyPlaceToAddressLines(formattedAddress: string): void {
    const parts = formattedAddress
      .split(',')
      .map((part) => part.replace(POSTCODE_IN_TEXT, '').trim())
      .filter((part) => part.length > 0)
      .filter((part) => !/^(uk|gb|united kingdom)$/i.test(part));

    if (parts.length === 0) {
      return;
    }

    this.form.controls.addressLine1.setValue(parts[0].slice(0, ADDRESS_LINE_MAX));
    this.form.controls.addressLine2.setValue(parts.slice(1).join(', ').slice(0, ADDRESS_LINE_MAX));
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
   *
   * Gated on UK_POSTCODE_PATTERN (not WardLookupService.isWellFormed, though the two agree in
   * practice) so the warning never flashes while the postcode is still being typed. A
   * 'not-found' result warns too, alongside a 'resolved'-but-unsupported borough: the table
   * only contains our supported boroughs, so a miss on a well-formed postcode means "not one
   * we serve" (or a postcode newer than the table's edition) either way. 'unavailable' (the
   * asset failed to load) never warns — a lookup failure isn't the visitor's fault to see.
   */
  private checkBorough(postcode: string): void {
    if (!UK_POSTCODE_PATTERN.test(postcode)) {
      this.boroughWarning = null;
      return;
    }
    combineLatest([this.wardLookup.lookup(postcode), this.featureFlags.supportedBoroughs()]).subscribe(
      ([result, supported]) => {
        if (result.status === 'resolved') {
          const covered = supported.some((b) => b.code === result.borough.code);
          this.boroughWarning = covered ? null : OUT_OF_AREA_WARNING;
          return;
        }
        this.boroughWarning = result.status === 'not-found' ? OUT_OF_AREA_WARNING : null;
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
