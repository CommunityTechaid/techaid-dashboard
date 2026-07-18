import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DeliveryDayAvailability } from '../models';

interface DayRow {
  date: string;
  label: string;
  sub: string;
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

  get rows(): DayRow[] {
    return (this.days ?? [])
      .map((day) => {
        const available = day.windows.filter((w) => w.spotsRemaining > 0);
        return { day, available };
      })
      .filter(({ available }) => available.length > 0)
      .map(({ day, available }) => ({
        date: day.date,
        label: day.dayLabel,
        sub: this.subLabel(day, available.length),
      }));
  }

  private subLabel(day: DeliveryDayAvailability, availableCount: number): string {
    if (availableCount === day.windows.length) {
      return 'Morning & afternoon available';
    }
    const availableName = day.windows.find((w) => w.spotsRemaining > 0)?.window.name ?? '';
    const fullName = day.windows.find((w) => w.spotsRemaining === 0)?.window.name ?? '';
    return `${availableName} only — ${fullName.replace(' window', '').toLowerCase()} is full`;
  }
}
