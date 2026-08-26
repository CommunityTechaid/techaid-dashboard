import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DeliveryDayAvailability } from '../models';

interface DayRow {
  date: string;
  label: string;
}

@Component({
  selector: 'app-day-step',
  standalone: true,
  imports: [],
  templateUrl: './day-step.component.html',
  styleUrl: './day-step.component.scss',
})
export class DayStepComponent {
  @Input() days: DeliveryDayAvailability[] | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;

  @Output() daySelected = new EventEmitter<string>();
  @Output() retry = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();

  get rows(): DayRow[] {
    return (this.days ?? [])
      .filter((day) => day.windows.some((w) => w.spotsRemaining > 0))
      .map((day) => ({
        date: day.date,
        label: day.dayLabel,
      }));
  }
}
