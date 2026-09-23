import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { DeliveryBookingConfirmation } from '../models';

@Component({
  selector: 'app-confirmation-step',
  standalone: true,
  imports: [],
  templateUrl: './confirmation-step.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './confirmation-step.component.scss',
})
export class ConfirmationStepComponent {
  @Input({ required: true }) confirmation!: DeliveryBookingConfirmation;

  get dayLabelWithYear(): string {
    const year = new Date(this.confirmation.date).getFullYear();
    return `${this.confirmation.dayLabel} ${year}`;
  }
}
