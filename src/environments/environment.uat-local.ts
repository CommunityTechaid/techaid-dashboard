// UAT environment for local e2e testing.
// Uses relative URLs so the Angular dev server proxy can forward requests to the UAT backend,
// avoiding CORS errors when running Playwright tests from localhost.
// See src/proxy.conf.uat.json and the 'uat-local' serve configuration in angular.json.
declare var require: any;
import { APP_VERSION } from './version';

import { ConfigParams } from '@app/state/config-params';

export const environment: ConfigParams = {
  production: false,
  environment: 'uat',
  graphql_endpoint: '/graphql',
  version: APP_VERSION,
  auth_endpoint: '/auth/user',
  auth_audience: 'https://api.communitytechaid.org.uk',
  auth_enabled: true,
  remote_config: false,
};
