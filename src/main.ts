import { enableProdMode, APP_INITIALIZER, LOCALE_ID, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withRouterConfig } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { provideToastr } from 'ngx-toastr';
import { provideAuth0 } from '@auth0/auth0-angular';
import { NgProgressModule } from 'ngx-progressbar';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { provideFormlyConfig } from '@ngx-formly/core';
import { QuillModule } from 'ngx-quill';

import { environment } from './environments/environment';
import { AppComponent } from './app/app.component';
import { ConfigService } from '@app/shared/services/config.service';
import { appSharedProviders } from '@app/shared';
import { appStateProviders } from '@app/state/state.module';
import { graphqlProviders } from './app/graphql.module';
import { appRoutes } from './app/app.routing.module';
import { FORMLYCONFIG, formlyProviders } from './app/shared/modules/formly';
import { provideNgProgressHttp } from '@app/shared/utils/app-ngx-progress-http';
import { dateRangeValidator, configServiceFactory } from './app/app.module';
import { FormlyCustomNote } from './app/views/corewidgets/components/kit-info/custom-notes';
import { FormlyCustomCreateNote } from './app/views/corewidgets/components/kit-info/custom-create-note';
import { FormlyCustomDeviceRequestNote } from './app/views/corewidgets/components/device-request-info/custom-notes';
import { FormlyCustomCreateDeviceRequestNote } from './app/views/corewidgets/components/device-request-info/custom-create-notes';
import { FormlyCustomReferringOrganisationContactNote } from './app/views/corewidgets/components/referring-organisation-contact-info/custom-notes';
import { FormlyCustomCreateReferringOrganisationContactNote } from './app/views/corewidgets/components/referring-organisation-contact-info/custom-create-notes';
import { FormlyCustomKitCheckboxType } from './app/views/corewidgets/components/kit-info/custom-kit-checkbox';
import { FormlyCustomKitInfoType } from './app/views/corewidgets/components/kit-info/custom-kit-info-input';

// Every date on this dashboard is a UK date. Angular's default LOCALE_ID is 'en-US', which
// renders `| date:'short'` as 8/22/26, 9:57 AM — read as 8 August by UK staff. Registering
// en-GB and providing it as LOCALE_ID makes the built-in date/number pipes format the British
// way (22/08/2026, 09:57) everywhere, rather than each template carrying its own format string.
registerLocaleData(localeEnGb);

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    { provide: LOCALE_ID, useValue: 'en-GB' },
    provideRouter(appRoutes, withRouterConfig({ onSameUrlNavigation: 'reload' })),
    provideAnimations(),
    provideHttpClient(withInterceptorsFromDi()),
    appStateProviders,
    ...graphqlProviders,
    ...appSharedProviders,
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
      ]
    }),
    provideAuth0({
      domain: 'techaid-auth.eu.auth0.com',
      clientId: 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX',
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: 'https://api.communitytechaid.org.uk',
      },
      cacheLocation: 'localstorage',
      useRefreshTokens: true,
    }),
    provideToastr({
      positionClass: 'toast-top-right',
      preventDuplicates: true,
    }),
    ...provideNgProgressHttp(),
    importProvidersFrom(
      FormsModule,
      ReactiveFormsModule,
      NgbModule,
      NgProgressModule,
      FormlyBootstrapModule,
      QuillModule.forRoot(),
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: configServiceFactory,
      deps: [ConfigService],
      multi: true
    },
  ]
}).catch(err => console.log(err));
