import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { AuthGuard } from '@app/shared/services/auth.guard';
import { AppFormModule } from '../../shared/modules/formly';
import { VolunteersIndexComponent } from './components/volunteer-index/volunteer-index.component';
import { VolunteerInfoComponent } from './components/volunteer-info/volunteer-info.component';
import { KitIndexComponent} from './components/kit-index/kit-index.component';
import { UserPermissionsComponent } from './components/user-permissions/user-permissions.component';
import { RoleIndexComponent } from './components/role-index/role-index.component';
import { RoleInfoComponent } from './components/role-info/role-info.component';
import { RolePermissionsComponent } from './components/role-permissions/role-permissions.component';
import { RoleUsersComponent } from './components/role-users/role-users.component';
import { UserRolesComponent } from './components/user-roles/user-roles.component';
import { AppSharedModule } from '@app/shared';
import { AppGridModule } from '@app/shared/modules/grid';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsModule } from '@ngxs/store';
import { KitInfoComponent } from './components/kit-info/kit-info.component';
import { DonorIndexComponent } from './components/donor-index/donor-index.component';
import { DonorInfoComponent } from './components/donor-info/donor-info.component';
import { DonorRequestComponent } from './components/donor-request/donor-request.component';
import { LightboxModule } from 'ngx-lightbox';
import { VolunteerComponent } from './components/volunteer/volunteer';
import { CoreWidgetState } from './state/corewidgets.state';
import { UserIndexComponent } from './components/user-index/user-index.component';
import { UserInfoComponent } from './components/user-info/user-info.component';
import { MapComponent } from './components/map/map-index.component';
import { MapViewComponent } from './components/map-view/map-view.component';
import { FaqIndexComponent } from './components/faq-index/faq-index.component';
import { FaqInfoComponent } from './components/faq-info/faq-info.component';
import { FaqListComponent } from './components/faq-list/faq-list.component';
import { PostIndexComponent } from './components/post-index/post-index.component';
import { PostInfoComponent } from './components/post-info/post-info.component';
import { PostDataComponent } from './components/post-data/post-data.component';
import { EmailThreadsComponent } from './components/email-threads/email-threads.component';
import { EmailComposeComponent } from './components/email-compose/email-compose.component';
import { EmailTemplatesIndexComponent } from './components/etemplates-index/etemplates-index.component';
import { EmailTemplatesInfoComponent } from './components/etemplates-info/etemplates-info.component';
import { DashboardIndexComponent } from './components/dashboard-index/dashboard-index.component';
import { OrgRequestComponent } from './components/org-request/org-request';
import { KitComponent } from './components/kit-component/kit-component.component';
import { ReportsComponent} from './components/reports/reports.component';
import { DeviceRequestIndexComponent } from './components/device-request-index/device-request-index.component';
import { DeviceRequestInfoComponent } from './components/device-request-info/device-request-info.component';
import { ReferringOrganisationIndexComponent } from './components/referring-organisation-index/referring-organisation-index.component';
import { ReferringOrganisationInfoComponent } from './components/referring-organisation-info/referring-organisation-info.component';
import { ReferringOrganisationContactIndexComponent } from './components/referring-organisation-contact-index/referring-organisation-contact-index.component';
import { ReferringOrganisationContactInfoComponent } from './components/referring-organisation-contact-info/referring-organisation-contact-info.component';
import { ReferringOrganisationContactComponent }  from './components/referring-organisation-contact-component/referring-organisation-contact-component.component';
import { DeviceRequestComponent } from './components/device-request-component/device-request-component.component';
import { AppLocalCSS } from './components/org-request/app-local-css.component';

const routes: Routes = [
  { path: '', component: DashboardIndexComponent, data: { title: '' } },
  { path: 'donate-device', component: DonorRequestComponent, data: { title: 'Donate Device' } },
  { path: 'volunteer', component: VolunteerComponent, data: { title: 'Volunteer' } },
  { path: 'faqs', component: FaqListComponent, data: { title: 'FAQs' } },
  { path: 'device-request-admin', component: OrgRequestComponent, data: { title: 'Device Request' }, canActivate: [AuthGuard] },
  { path: 'organisation-device-request', component: OrgRequestComponent, data: { title: 'Device Request' } },
  { path: 'dashboard/map', component: MapViewComponent, data: { title: 'Map' } },
  { path: 'dashboard/volunteers', component: VolunteersIndexComponent, data: { title: 'Volunteers' }, canActivate: [AuthGuard] },
  { path: 'dashboard/volunteers/:userId', component: VolunteerInfoComponent, data: { title: 'Volunteer' }, canActivate: [AuthGuard] },
  { path: 'dashboard/devices', component: KitIndexComponent, data: { title: 'Devices' }, canActivate: [AuthGuard] },
  { path: 'dashboard/devices/:kitId', component: KitInfoComponent, canActivate: [AuthGuard] },
  { path: 'dashboard/donors', component: DonorIndexComponent, data: { title: 'Donors' }, canActivate: [AuthGuard] },
  { path: 'dashboard/donors/:donorId', component: DonorInfoComponent, data: { title: 'Donor' }, canActivate: [AuthGuard] },
  { path: 'dashboard/roles', component: RoleIndexComponent, data: { title: 'Roles' },  canActivate: [AuthGuard]},
  { path: 'dashboard/roles/:roleId', component: RoleInfoComponent, data: { title: 'Role' },  canActivate: [AuthGuard] },
  { path: 'dashboard/users', component: UserIndexComponent, data: { title: 'Users' },  canActivate: [AuthGuard] },
  { path: 'dashboard/users/:userId', component: UserInfoComponent, data: { title: 'User' },  canActivate: [AuthGuard] },
  { path: 'dashboard/faqs', component: FaqIndexComponent, data: { title: 'FAQs' },  canActivate: [AuthGuard] },
  { path: 'dashboard/faqs/:faqId', component: FaqInfoComponent, data: { title: 'FAQ' },  canActivate: [AuthGuard] },
  { path: 'dashboard/posts', component: PostIndexComponent, data: { title: 'Posts' },  canActivate: [AuthGuard] },
  { path: 'dashboard/posts/:postId', component: PostInfoComponent, data: { title: 'Post' },  canActivate: [AuthGuard] },
  { path: 'dashboard/email', component: EmailComposeComponent, data: { title: 'Email' }, canActivate: [AuthGuard] },
  { path: 'dashboard/email/templates', component: EmailTemplatesIndexComponent, data: { title: 'Templates' }, canActivate: [AuthGuard] },
  { path: 'dashboard/email/templates/:templateId', component: EmailTemplatesInfoComponent, data: { title: 'Template' },  canActivate: [AuthGuard] },
  { path: 'dashboard/device-requests', component: DeviceRequestIndexComponent, data: { title: 'Device Requests' }, canActivate: [AuthGuard] },
  { path: 'dashboard/device-requests/:requestId', component: DeviceRequestInfoComponent, canActivate: [AuthGuard] },
  { path: 'dashboard/referring-organisations', component: ReferringOrganisationIndexComponent, data: { title: 'Organisations' }, canActivate: [AuthGuard] },
  { path: 'dashboard/referring-organisations/:orgId', component: ReferringOrganisationInfoComponent, data: { title: 'Organisation' }, canActivate: [AuthGuard] },
  { path: 'dashboard/referring-organisation-contacts', component: ReferringOrganisationContactIndexComponent, data: { title: 'Referees' }, canActivate: [AuthGuard] },
  { path: 'dashboard/referring-organisation-contacts/:refereeId', component: ReferringOrganisationContactInfoComponent, data: { title: 'Referee' }, canActivate: [AuthGuard] },
  { path: 'dashboard', component: DashboardIndexComponent, data: { title: 'Dashboard' }, canActivate: [AuthGuard] },
  { path: 'about-us', component: PostDataComponent, data: { title: 'About Us' } },
  { path: 'reports', component: ReportsComponent, data: { title: 'Reports' }, canActivate: [AuthGuard] },
  { path: '**', component: PostDataComponent },
];

@NgModule({
  declarations: [
    VolunteersIndexComponent,
    UserPermissionsComponent,
    RoleIndexComponent,
    VolunteerInfoComponent,
    RoleInfoComponent,
    RolePermissionsComponent,
    UserRolesComponent,
    RoleUsersComponent,
    KitIndexComponent,
    KitInfoComponent,
    DonorIndexComponent,
    DonorInfoComponent,
    DonorRequestComponent,
    VolunteerComponent,
    UserIndexComponent,
    UserInfoComponent,
    MapComponent,
    MapViewComponent,
    FaqIndexComponent,
    FaqInfoComponent,
    FaqListComponent,
    PostIndexComponent,
    PostInfoComponent,
    PostDataComponent,
    EmailThreadsComponent,
    EmailComposeComponent,
    EmailTemplatesIndexComponent,
    EmailTemplatesInfoComponent,
    DashboardIndexComponent,
    OrgRequestComponent,
    KitComponent,
    ReportsComponent,
    DeviceRequestIndexComponent,
    DeviceRequestInfoComponent,
    ReferringOrganisationIndexComponent,
    ReferringOrganisationInfoComponent,
    ReferringOrganisationContactIndexComponent,
    ReferringOrganisationContactInfoComponent,
    ReferringOrganisationContactComponent,
    DeviceRequestComponent,
    AppLocalCSS
  ],
  imports: [
    LightboxModule,
    NgxsModule.forFeature([CoreWidgetState]),
    AppGridModule,
    CommonModule,
    AppSharedModule,
    AppFormModule,
    NgbModule,
    RouterModule.forChild(routes),
  ],
  providers: [
  ],
})
export class CoreWidgetsModule { }
