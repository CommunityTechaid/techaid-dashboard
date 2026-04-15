import { enableProdMode, APP_INITIALIZER, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
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
import { FormlyCustomKitCheckboxType } from './app/views/corewidgets/components/kit-info/custom-kit-checkbox';
import { FormlyCustomKitInfoType } from './app/views/corewidgets/components/kit-info/custom-kit-info-input';

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
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
