import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { DeliveryDayAvailability, DeliveryWindow } from '../models';

@Component({
  selector: 'app-window-step',
  standalone: true,
  imports: [],
  templateUrl: './window-step.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './window-step.component.scss',
})
export class WindowStepComponent {
  @Input() day: DeliveryDayAvailability | null = null;

  @Output() windowSelected = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();

  get availableWindows(): DeliveryWindow[] {
    return (this.day?.windows ?? [])
      .filter((w) => w.spotsRemaining > 0)
      .map((w) => w.window);
  }
}
