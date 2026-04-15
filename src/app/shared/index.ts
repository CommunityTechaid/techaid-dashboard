import { Provider } from '@angular/core';
import { AuthGuard } from './services/auth.guard';
import { ConfigService } from './services/config.service';
import { AuthenticationService } from './services/authentication.service';

export { InputMaskComponent } from './components/input-mask/input-mask.component';
export { YesNoPipe } from './pipes/yesno.pipe';
export { AppInitialComponent } from './components/app-initial/app-initial.component';

export const appSharedProviders: Provider[] = [
    AuthenticationService,
    AuthGuard,
    ConfigService,
];
