import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DeliveryDayAvailability, DeliveryWindow } from '../models';

export interface DetailsFormValue {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  address: string;
  accessNotes: string;
  ctaReference: string;
}

const UK_PHONE_PATTERN = /^[0-9 +()-]{7,20}$/;

@Component({
  selector: 'app-details-step',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './details-step.component.html',
  styleUrl: './details-step.component.scss',
})
export class DetailsStepComponent {
  @Input() day: DeliveryDayAvailability | null = null;
  @Input() window: DeliveryWindow | null = null;
  @Input() submitting = false;
  @Input() submitError: string | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<DetailsFormValue>();

  private readonly fb = inject(FormBuilder);

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

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(this.form.getRawValue());
  }

  invalid(control: string): boolean {
    const c = this.form.get(control);
    return !!c && c.invalid && c.touched;
  }
}
