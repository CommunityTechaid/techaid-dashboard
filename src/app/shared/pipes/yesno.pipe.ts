import { Pipe, PipeTransform, NgZone, ChangeDetectorRef, OnDestroy } from '@angular/core';

@Pipe({
    name: 'yesNo',
    pure: false
})
export class YesNoPipe implements PipeTransform {
  constructor(private changeDetectorRef: ChangeDetectorRef, private ngZone: NgZone) { }

  transform(value: boolean) {
    if (value === true) {
      return 'Yes';
    } else {
      return 'No';
    }
  }
}
