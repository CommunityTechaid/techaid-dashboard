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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ConfigService } from '@app/shared/services/config.service';
import { DeliveryDayAvailability, DeliveryWindow } from '../models';
import { TurnstileService } from '../turnstile.service';

export interface DetailsFormValue {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  address: string;
  accessNotes: string;
  ctaReference: string;
  turnstileToken?: string;
}

const UK_PHONE_PATTERN = /^[0-9 +()-]{7,20}$/;

@Component({
  selector: 'app-details-step',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './details-step.component.html',
  styleUrl: './details-step.component.scss',
})
export class DetailsStepComponent implements AfterViewInit, OnChanges {
  @Input() day: DeliveryDayAvailability | null = null;
  @Input() window: DeliveryWindow | null = null;
  @Input() submitting = false;
  @Input() submitError: string | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<DetailsFormValue>();

  @ViewChild('turnstileHost') turnstileHost?: ElementRef<HTMLElement>;

  private readonly fb = inject(FormBuilder);
  private readonly config = inject(ConfigService);
  private readonly turnstile = inject(TurnstileService);

  readonly siteKey = (this.config.environment.turnstile_site_key ?? '').trim();
  readonly turnstileToken = signal<string | null>(null);
  readonly verificationPending = signal(false);

  private widgetId: string | null = null;

  readonly form = this.fb.nonNullable.group({
    firstName: ['', Validators.required],
    surname: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.pattern(UK_PHONE_PATTERN)]],
    address: ['', Validators.required],
    accessNotes: [''],
    ctaReference: ['', Validators.required],
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

  invalid(control: string): boolean {
    const c = this.form.get(control);
    return !!c && c.invalid && c.touched;
  }
}
