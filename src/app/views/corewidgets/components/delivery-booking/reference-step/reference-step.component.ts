import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-reference-step',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './reference-step.component.html',
  styleUrl: './reference-step.component.scss',
})
export class ReferenceStepComponent {
  @Input() checking = false;
  @Input() error: string | null = null;

  @Output() referenceSubmitted = new EventEmitter<number>();

  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    ctaReference: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
  });

  invalid(control: string): boolean {
    const c = this.form.get(control);
    return !!c && c.invalid && c.touched;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.referenceSubmitted.emit(Number(this.form.getRawValue().ctaReference));
  }
}
