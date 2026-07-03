import { EnvironmentProviders } from '@angular/core';
import { provideStore } from '@ngxs/store';
import { withNgxsRouterPlugin } from '@ngxs/router-plugin';
import { withNgxsFormPlugin } from '@ngxs/form-plugin';
import { withNgxsReduxDevtoolsPlugin } from '@ngxs/devtools-plugin';
import { UserState } from './user/user.state';

export { UserState } from './user/user.state';

export const appStateProviders: EnvironmentProviders = provideStore(
    [UserState],
    {
        // Without this NGXS builds property getters via new Function(),
        // which the Content-Security-Policy (no unsafe-eval) blocks.
        compatibility: { strictContentSecurityPolicy: true }
    },
    withNgxsRouterPlugin(),
    withNgxsFormPlugin(),
    withNgxsReduxDevtoolsPlugin()
);
