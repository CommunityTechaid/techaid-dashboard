import { ApplicationRef, inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

let registration: Promise<boolean> | undefined;

/**
 * Registers the Formly types (see formly-setup.ts) before any route that renders a <formly-form>
 * activates. Attach it to every route that hosts a Formly form, directly or through a child
 * component. A form host without it throws "There is no type by the name ..." at first render.
 *
 * It must NOT statically import formly-setup (that would pull Formly back into the eager bundle);
 * the dynamic import is the whole point. The result is cached, so later navigations are instant.
 * On a failed chunk load the cache is cleared so the next navigation can retry.
 */
export const formlyTypesGuard: CanActivateFn = () => {
  const root = inject(ApplicationRef).injector;
  registration ??= import('./formly-setup')
    .then(m => {
      m.registerFormlyTypes(root);
      return true;
    })
    .catch(err => {
      registration = undefined;
      throw err;
    });
  return registration;
};
