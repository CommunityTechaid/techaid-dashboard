import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '@env/environment';

/**
 * Gates the prototype device prep-mode route behind the `feature_prep_mode`
 * environment flag (off in production). Reads the compiled-in environment config
 * directly — the same per-env mechanism as `turnstile_site_key` — with no remote
 * config or flag service. When off, navigating straight to the path redirects to
 * the dashboard root instead of rendering the page.
 */
export const prepModeEnabledGuard: CanActivateFn = () => {
  const router = inject(Router);
  return environment.feature_prep_mode ? true : router.parseUrl('/dashboard');
};
