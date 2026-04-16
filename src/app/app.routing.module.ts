import { Routes } from '@angular/router';
import { App404 } from '@app/shared/components/app-404/app-404.component';

export const appRoutes: Routes = [
  {
    path: '',
    loadChildren: () => import('./views/corewidgets/core-widgets.routes').then(m => m.CORE_WIDGET_ROUTES)
  },
  { path: '404', component: App404 },
  { path: '**', redirectTo: '/404' },
];
