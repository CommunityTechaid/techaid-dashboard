import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ConfigService } from './config.service';

/** Lets a route through on dev/UAT only; production gets the 404 page. For prototypes. */
export const nonProductionGuard: CanActivateFn = () => {
  const config = inject(ConfigService);
  return config.environment.production ? inject(Router).parseUrl('/404') : true;
};
