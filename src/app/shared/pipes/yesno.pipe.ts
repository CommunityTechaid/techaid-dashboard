import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'yesNo',
    pure: false
})
export class YesNoPipe implements PipeTransform {

  transform(value: boolean) {
    if (value === true) {
      return 'Yes';
    } else {
      return 'No';
    }
  }
}
