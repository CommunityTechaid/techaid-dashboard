import { AbstractControl } from '@angular/forms';
import { ConfigService } from '@app/shared/services/config.service';

export function dateRangeValidator(control: AbstractControl) {
  const { after, before } = control.value;

  // avoid displaying the message error when values are empty
  if (!after || !before) {
    return null;
  }

  if (after < before) {
    return null;
  }

  return { dateRange: { message: 'Date range is invalid' } };
}

export function configServiceFactory(config: ConfigService) {
  return () => config.load();
}
