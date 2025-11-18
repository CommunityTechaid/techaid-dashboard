import { BrowserModule } from '@angular/platform-browser';
import { NgModule, APP_INITIALIZER } from '@angular/core';

import { AppSharedModule } from '@app/shared';
import { AppComponent } from './app.component';
import { FormlyModule } from '@ngx-formly/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { AppFormModule } from './shared/modules/formly';
import { AppHeader } from './components/app-header/app.header.component';
import { AppSidebar } from './components/app-sidebar/app.sidebar.component';
import { App404 } from '@app/shared/components/app-404/app-404.component';
import { AppAuthModule } from './shared/modules/auth';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AppRoutingModule } from './app.routing.module';
import { NgProgressModule } from 'ngx-progressbar';
import { NgProgressHttpModule } from 'ngx-progressbar/http';
import { ToastrModule } from 'ngx-toastr';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ConfigService } from '@app/shared/services/config.service';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { AppStateModule } from '@app/state/state.module';
import { FormsModule, AbstractControl } from '@angular/forms';
import { GraphQLModule } from './graphql.module';
import { FormlyCustomNote } from './views/corewidgets/components/kit-info/custom-notes';
import { FormlyCustomCreateNote } from './views/corewidgets/components/kit-info/custom-create-note';
import { FormlyCustomKitCheckboxType } from './views/corewidgets/components/kit-info/custom-kit-checkbox'
import { FormlyCustomKitInfoType } from './views/corewidgets/components/kit-info/custom-kit-info-input'
import { FormlyCustomDeviceRequestNote } from './views/corewidgets/components/device-request-info/custom-notes';
import { FormlyCustomCreateDeviceRequestNote } from './views/corewidgets/components/device-request-info/custom-create-notes';


@NgModule({ declarations: [
        AppComponent,
        AppHeader,
        AppSidebar,
        App404,
        FormlyCustomNote,
        FormlyCustomCreateNote,
        FormlyCustomDeviceRequestNote,
        FormlyCustomCreateDeviceRequestNote,
        FormlyCustomKitCheckboxType,
        FormlyCustomKitInfoType
    ],
    bootstrap: [AppComponent], imports: [FormsModule,
        BrowserAnimationsModule,
        AppSharedModule.forRoot(),
        FormlyModule.forRoot({
            validators: [{ name: 'dateRange', validation: dateRangeValidator }]
        }),
        FormlyBootstrapModule,
        NgbModule,
        AppFormModule.forRoot(),
        ToastrModule.forRoot({
            positionClass: 'toast-top-right',
            preventDuplicates: true
        }),
        AppAuthModule,
        BrowserModule,
        NgProgressModule,
        NgProgressHttpModule,
        AppRoutingModule,
        AppStateModule,
        GraphQLModule,
        FormlyModule.forRoot({
            types: [
                { name: 'notes', component: FormlyCustomNote },
                { name: 'new-note', component: FormlyCustomCreateNote },
                { name: 'device-request-notes', component: FormlyCustomDeviceRequestNote },
                { name: 'device-request-new-note', component: FormlyCustomCreateDeviceRequestNote },
                { name: 'kit-checkbox', component: FormlyCustomKitCheckboxType },
                { name: 'kit-info-input', component: FormlyCustomKitInfoType }
            ]
        })], providers: [
        {
            provide: APP_INITIALIZER,
            useFactory: configServiceFactory,
            deps: [ConfigService],
            multi: true
        },
        provideHttpClient(withInterceptorsFromDi()),
    ] })
export class AppModule { }

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
