import { enableProdMode, APP_INITIALIZER, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { configServiceFactory, dateRangeValidator } from './app/app.module';
import { environment } from './environments/environment';
import { ConfigService } from '@app/shared/services/config.service';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AppSharedModule } from '@app/shared';
import { FormlyModule } from '@ngx-formly/core';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { AppFormModule } from './app/shared/modules/formly';
import { ToastrModule } from 'ngx-toastr';
import { AppAuthModule } from './app/shared/modules/auth';
import { AuthModule } from '@auth0/auth0-angular';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { NgProgressModule } from 'ngx-progressbar';
import { AppNgProgressHttpModule } from '@app/shared/utils/app-ngx-progress-http';
import { AppRoutingModule } from './app/app.routing.module';
import { AppStateModule } from '@app/state/state.module';
import { GraphQLModule } from './app/graphql.module';
import { FormlyCustomNote } from './app/views/corewidgets/components/kit-info/custom-notes';
import { FormlyCustomCreateNote } from './app/views/corewidgets/components/kit-info/custom-create-note';
import { FormlyCustomDeviceRequestNote } from './app/views/corewidgets/components/device-request-info/custom-notes';
import { FormlyCustomCreateDeviceRequestNote } from './app/views/corewidgets/components/device-request-info/custom-create-notes';
import { FormlyCustomKitCheckboxType } from './app/views/corewidgets/components/kit-info/custom-kit-checkbox';
import { FormlyCustomKitInfoType } from './app/views/corewidgets/components/kit-info/custom-kit-info-input';
import { AppComponent } from './app/app.component';

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
    providers: [
        provideZoneChangeDetection(),importProvidersFrom(FormsModule, ReactiveFormsModule, AppSharedModule.forRoot(), FormlyModule.forRoot({
            validators: [{ name: 'dateRange', validation: dateRangeValidator }]
        }), FormlyBootstrapModule, NgbModule, AppFormModule.forRoot(), ToastrModule.forRoot({
            positionClass: 'toast-top-right',
            preventDuplicates: true
        }), AppAuthModule, AuthModule.forRoot({
            domain: 'techaid-auth.eu.auth0.com',
            clientId: 'puJcT35DydtxJUsOfjNFVg7MBf19UDzX',
            authorizationParams: {
                redirect_uri: window.location.origin,
                audience: 'https://api.communitytechaid.org.uk',
            },
            cacheLocation: 'localstorage',
        }), BrowserModule, NgProgressModule, AppNgProgressHttpModule.forRoot(), AppRoutingModule, AppStateModule, GraphQLModule, FormlyModule.forRoot({
            types: [
                { name: 'notes', component: FormlyCustomNote },
                { name: 'new-note', component: FormlyCustomCreateNote },
                { name: 'device-request-notes', component: FormlyCustomDeviceRequestNote },
                { name: 'device-request-new-note', component: FormlyCustomCreateDeviceRequestNote },
                { name: 'kit-checkbox', component: FormlyCustomKitCheckboxType },
                { name: 'kit-info-input', component: FormlyCustomKitInfoType }
            ]
        })),
        {
            provide: APP_INITIALIZER,
            useFactory: configServiceFactory,
            deps: [ConfigService],
            multi: true
        },
        provideHttpClient(withInterceptorsFromDi()),
        provideAnimations()
    ]
})
  .catch(err => console.log(err));
