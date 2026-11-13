import { enableProdMode, APP_INITIALIZER, ErrorHandler, LOCALE_ID, importProvidersFrom, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEnGb from '@angular/common/locales/en-GB';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideToastr } from 'ngx-toastr';
import { provideAuth0 } from '@auth0/auth0-angular';
import { provideNgProgressHttp, progressInterceptor } from 'ngx-progressbar/http';

import { environment } from './environments/environment';
import { AppComponent } from './app/app.component';
import { ConfigService } from '@app/shared/services/config.service';
import { appSharedProviders } from '@app/shared';
import { appStateProviders } from '@app/state/state.module';
import { graphqlProviders } from './app/graphql.module';
import { appRoutes } from './app/app.routing.module';
import { configServiceFactory } from './app/app.module';
import { GlobalErrorHandler } from './app/shared/services/global-error-handler';
import { errorRefInterceptor } from './app/shared/services/error-ref.interceptor';

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
    // Zoneless change detection (#115): views repaint via signals, markForCheck, async pipe and template events.
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    { provide: LOCALE_ID, useValue: 'en-GB' },
    provideRouter(appRoutes, withRouterConfig({ onSameUrlNavigation: 'reload' })),
    provideHttpClient(withXhr(), withInterceptors([progressInterceptor, errorRefInterceptor])),
    appStateProviders,
    ...graphqlProviders,
    ...appSharedProviders,
    // Formly types are NOT registered here: formlyTypesGuard loads them with the routes that render
    // a <formly-form> (src/app/shared/modules/formly/formly-types.guard.ts).
    provideAuth0({
      domain: 'techaid-auth.eu.auth0.com',
      clientId: environment.auth_client_id,
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
    provideNgProgressHttp({}),
    importProvidersFrom(
      FormsModule,
      ReactiveFormsModule,
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: configServiceFactory,
      deps: [ConfigService],
      multi: true
    },
  ]
}).catch(err => console.log(err));
