// Formly's type registry, loaded on demand (perf: it used to be registered at bootstrap in main.ts,
// which kept Formly core + bootstrap types, ng-select, the ngb date/time pickers, date-fns and every
// custom field component in the initial `main` bundle).
//
// This file is only ever reached through a dynamic import() from formly-types.guard.ts, so it and
// everything it pulls in lands in lazy chunks. Do NOT import it statically from main.ts, a service,
// or any component that is part of the initial load.
import { createEnvironmentInjector, EnvironmentInjector, importProvidersFrom } from '@angular/core';
import { FORMLY_CONFIG, FormlyConfig, provideFormlyConfig } from '@ngx-formly/core';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';

import { formlyProviders } from './index';
import { dateRangeValidator } from '../../../app.module';
import { FormlyCustomNote } from '../../../views/corewidgets/components/kit-info/custom-notes';
import { FormlyCustomCreateNote } from '../../../views/corewidgets/components/kit-info/custom-create-note';
import { FormlyCustomDeviceRequestNote } from '../../../views/corewidgets/components/device-request-info/custom-notes';
import { FormlyCustomCreateDeviceRequestNote } from '../../../views/corewidgets/components/device-request-info/custom-create-notes';
import { FormlyCustomReferringOrganisationContactNote } from '../../../views/corewidgets/components/referring-organisation-contact-info/custom-notes';
import { FormlyCustomCreateReferringOrganisationContactNote } from '../../../views/corewidgets/components/referring-organisation-contact-info/custom-create-notes';
import { FormlyCustomKitCheckboxType } from '../../../views/corewidgets/components/kit-info/custom-kit-checkbox';
import { FormlyCustomKitInfoType } from '../../../views/corewidgets/components/kit-info/custom-kit-info-input';

/**
 * Adds every Formly type, wrapper, validator, extension and validation message to the ROOT
 * FormlyConfig singleton. Writing into the root singleton (rather than providing FORMLY_CONFIG on a
 * route injector) is deliberate: NgbModal content and any other view created outside a route's
 * injector tree still resolve FormlyConfig from root, so they see the types too.
 *
 * The providers below are exactly the ones main.ts used to register at root, in the same order
 * (later registrations override or merge into earlier ones, e.g. the `form-field` wrapper), and are
 * evaluated in a throwaway child injector so Formly's own provider factories (withDefaultConfig,
 * FormlyBootstrapModule's per-type configs) run unchanged.
 */
export function registerFormlyTypes(root: EnvironmentInjector): void {
  const scratch = createEnvironmentInjector(
    [
      ...formlyProviders,
      provideFormlyConfig({
        validators: [{ name: 'dateRange', validation: dateRangeValidator }],
        types: [
          { name: 'notes', component: FormlyCustomNote },
          { name: 'new-note', component: FormlyCustomCreateNote },
          { name: 'device-request-notes', component: FormlyCustomDeviceRequestNote },
          { name: 'device-request-new-note', component: FormlyCustomCreateDeviceRequestNote },
          { name: 'referee-notes', component: FormlyCustomReferringOrganisationContactNote },
          { name: 'referee-new-note', component: FormlyCustomCreateReferringOrganisationContactNote },
          { name: 'kit-checkbox', component: FormlyCustomKitCheckboxType },
          { name: 'kit-info-input', component: FormlyCustomKitInfoType },
        ],
      }),
      importProvidersFrom(FormlyBootstrapModule),
    ],
    root,
  );
  root.get(FormlyConfig).addConfig(scratch.get(FORMLY_CONFIG));}
