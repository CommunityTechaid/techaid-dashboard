import { Routes } from '@angular/router';
import { provideStates } from '@ngxs/store';
import { AuthGuard } from '@app/shared/services/auth.guard';
import { deliveryBookingVisibleGuard } from '@app/shared/services/delivery-booking-visible.guard';
import { CoreWidgetState } from './state/corewidgets.state';

// Every route lazy-loads its component so esbuild emits one chunk per route
// (shared dependencies are hoisted into common chunks automatically) instead
// of bundling all ~30 feature components into a single core-widgets chunk.

export const CORE_WIDGET_ROUTES: Routes = [
  {
    path: '',
    providers: [provideStates([CoreWidgetState])],
    children: [
      { path: '', loadComponent: () => import('./components/dashboard-index/dashboard-index.component').then(m => m.DashboardIndexComponent), data: { title: '' } },
      { path: 'device-request-admin', loadComponent: () => import('./components/org-request/org-request').then(m => m.OrgRequestComponent), data: { title: 'Device Request' }, canActivate: [AuthGuard] },
      { path: 'organisation-device-request', loadComponent: () => import('./components/org-request/org-request').then(m => m.OrgRequestComponent), data: { title: 'Device Request' } },
      // Public device-delivery booking page — no AuthGuard so members of the public can book without a login.
      // deliveryBookingVisibleGuard hides it on production until the delivery-booking feature flag is on.
      { path: 'delivery-booking', loadComponent: () => import('./components/delivery-booking/delivery-booking.component').then(m => m.DeliveryBookingComponent), data: { title: 'Book a delivery' }, canActivate: [deliveryBookingVisibleGuard] },
      { path: 'dashboard/admin-panel', loadComponent: () => import('./components/admin-panel/admin-panel.component').then(m => m.AdminPanelComponent), data: { title: 'Admin Panel' }, canActivate: [AuthGuard] },
      { path: 'dashboard/feature-flags', loadComponent: () => import('./components/feature-flags/feature-flags.component').then(m => m.FeatureFlagsComponent), data: { title: 'Feature Flags' }, canActivate: [AuthGuard] },
      { path: 'dashboard/devices', loadComponent: () => import('./components/kit-index/kit-index.component').then(m => m.KitIndexComponent), data: { title: 'Devices' }, canActivate: [AuthGuard] },
      { path: 'dashboard/devices/:kitId', loadComponent: () => import('./components/kit-info/kit-info.component').then(m => m.KitInfoComponent), canActivate: [AuthGuard] },
      { path: 'dashboard/donors', loadComponent: () => import('./components/donor-index/donor-index.component').then(m => m.DonorIndexComponent), data: { title: 'Donors' }, canActivate: [AuthGuard] },
      { path: 'dashboard/donors/:donorId', loadComponent: () => import('./components/donor-info/donor-info.component').then(m => m.DonorInfoComponent), data: { title: 'Donor' }, canActivate: [AuthGuard] },
      { path: 'dashboard/donor-parents', loadComponent: () => import('./components/donor-parent-index/donor-parent-index.component').then(m => m.DonorParentIndexComponent), data: { title: 'Parent Donors' }, canActivate: [AuthGuard] },
      { path: 'dashboard/donor-parents/:donorParentId', loadComponent: () => import('./components/donor-parent-info/donor-parent-info.component').then(m => m.DonorParentInfoComponent), data: { title: 'Parent Donor' }, canActivate: [AuthGuard] },
      { path: 'dashboard/roles', loadComponent: () => import('./components/role-index/role-index.component').then(m => m.RoleIndexComponent), data: { title: 'Roles' }, canActivate: [AuthGuard] },
      { path: 'dashboard/roles/:roleId', loadComponent: () => import('./components/role-info/role-info.component').then(m => m.RoleInfoComponent), data: { title: 'Role' }, canActivate: [AuthGuard] },
      { path: 'dashboard/users', loadComponent: () => import('./components/user-index/user-index.component').then(m => m.UserIndexComponent), data: { title: 'Users' }, canActivate: [AuthGuard] },
      { path: 'dashboard/users/:userId', loadComponent: () => import('./components/user-info/user-info.component').then(m => m.UserInfoComponent), data: { title: 'User' }, canActivate: [AuthGuard] },
      { path: 'dashboard/posts', loadComponent: () => import('./components/post-index/post-index.component').then(m => m.PostIndexComponent), data: { title: 'Posts' }, canActivate: [AuthGuard] },
      { path: 'dashboard/posts/:postId', loadComponent: () => import('./components/post-info/post-info.component').then(m => m.PostInfoComponent), data: { title: 'Post' }, canActivate: [AuthGuard] },
      { path: 'dashboard/device-requests', loadComponent: () => import('./components/device-request-index/device-request-index.component').then(m => m.DeviceRequestIndexComponent), data: { title: 'Device Requests' }, canActivate: [AuthGuard] },
      { path: 'dashboard/device-requests/:requestId', loadComponent: () => import('./components/device-request-info/device-request-info.component').then(m => m.DeviceRequestInfoComponent), canActivate: [AuthGuard] },
      { path: 'dashboard/distributions-and-deliveries', loadComponent: () => import('./components/distributions-and-deliveries-index/distributions-and-deliveries-index.component').then(m => m.DistributionsAndDeliveriesIndexComponent), data: { title: 'Distributions and Deliveries' }, canActivate: [AuthGuard] },
      { path: 'dashboard/distributions-and-deliveries/:requestId', loadComponent: () => import('./components/device-request-info/device-request-info.component').then(m => m.DeviceRequestInfoComponent), canActivate: [AuthGuard] },
      { path: 'dashboard/referring-organisations', loadComponent: () => import('./components/referring-organisation-index/referring-organisation-index.component').then(m => m.ReferringOrganisationIndexComponent), data: { title: 'Organisations' }, canActivate: [AuthGuard] },
      { path: 'dashboard/referring-organisations/:orgId', loadComponent: () => import('./components/referring-organisation-info/referring-organisation-info.component').then(m => m.ReferringOrganisationInfoComponent), data: { title: 'Organisation' }, canActivate: [AuthGuard] },
      { path: 'dashboard/referring-organisation-contacts', loadComponent: () => import('./components/referring-organisation-contact-index/referring-organisation-contact-index.component').then(m => m.ReferringOrganisationContactIndexComponent), data: { title: 'Referees' }, canActivate: [AuthGuard] },
      { path: 'dashboard/referring-organisation-contacts/:refereeId', loadComponent: () => import('./components/referring-organisation-contact-info/referring-organisation-contact-info.component').then(m => m.ReferringOrganisationContactInfoComponent), data: { title: 'Referee' }, canActivate: [AuthGuard] },
      { path: 'dashboard', loadComponent: () => import('./components/dashboard-index/dashboard-index.component').then(m => m.DashboardIndexComponent), data: { title: 'Dashboard' }, canActivate: [AuthGuard] },
      { path: '**', loadComponent: () => import('./components/post-data/post-data.component').then(m => m.PostDataComponent) },
    ]
  }
];
