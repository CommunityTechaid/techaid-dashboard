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
import { HttpClientModule } from '@angular/common/http';
import { AppRoutingModule } from './app.routing.module';
import { NgProgressModule } from '@ngx-progressbar/core';
import { AppNgProgressHttpModule } from '@app/shared/utils/app-ngx-progress-http.ts';
import { ToastrModule } from 'ngx-toastr';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ConfigService } from '@app/shared/services/config.service';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { AppStateModule } from '@app/state/state.module';
import { FormsModule } from '@angular/forms';
import { GraphQLModule } from './graphql.module';
import { FormlyCustomNote } from './views/corewidgets/components/kit-info/custom-notes';
import { FormlyCustomCreateNote } from './views/corewidgets/components/kit-info/custom-create-note';
import { FormlyCustomKitInfoType } from './views/corewidgets/components/kit-info/custom-kit-info-input'

@NgModule({
  declarations: [
    AppComponent,
    AppHeader,
    AppSidebar,
    App404,
    FormlyCustomNote,
    FormlyCustomCreateNote,
    FormlyCustomKitInfoType
  ],
  imports: [
    FormsModule,
    BrowserAnimationsModule,
    AppSharedModule.forRoot(),
    FormlyModule.forRoot(),
    FormlyBootstrapModule,
    NgbModule,
    AppFormModule.forRoot(),
    ToastrModule.forRoot({
      positionClass: 'toast-top-right',
      preventDuplicates: true
    }),
    AppAuthModule,
    BrowserModule,
    HttpClientModule,
    NgProgressModule,
    AppNgProgressHttpModule.forRoot(),
    AppRoutingModule,
    AppStateModule,
    GraphQLModule,
    FormlyModule.forRoot({
      types: [
        { name: 'notes', component: FormlyCustomNote },
        { name: 'new-note', component: FormlyCustomCreateNote},
        { name: 'kit-info-input', component: FormlyCustomKitInfoType}
      ]
    })

  ],
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: configServiceFactory,
      deps: [ConfigService],
      multi: true
    },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }


export function configServiceFactory(config: ConfigService) {
  return () => config.load();
}
