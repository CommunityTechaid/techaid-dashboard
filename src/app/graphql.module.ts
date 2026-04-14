import { NgModule } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Apollo, APOLLO_OPTIONS } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { ApolloClientOptions, ApolloLink, InMemoryCache } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { ConfigService } from '@app/shared/services/config.service';
import { AuthenticationService } from './shared/services/authentication.service';


export function createApollo(httpLink: HttpLink, config: ConfigService, authService: AuthenticationService): ApolloClientOptions {
  const http = httpLink.create({
    uri: config.environment.graphql_endpoint
  });

  const asyncAuthLink = setContext((_request, _previous) => new Promise((success) => {
    authService.getTokenSilently$({ audience: config.environment.auth_audience }).subscribe(
      token => {
        success({ headers: new HttpHeaders({ 'Authorization': `Bearer ${token}` }) });
      },
      () => success({})
    );
  }));

  const errorHandler = onError(_options => {
    // network errors are handled silently — lists will be empty without the API
  });

  return {
    link: errorHandler.concat(asyncAuthLink.concat(http)),
    cache: new InMemoryCache(),
  };
}

@NgModule({
  providers: [
    // Apollo must be explicitly provided — ApolloModule no longer exists in apollo-angular v13.
    // provideApollo() does the same thing but requires a zero-argument factory (no DI).
    Apollo,
    {
      provide: APOLLO_OPTIONS,
      useFactory: createApollo,
      deps: [HttpLink, ConfigService, AuthenticationService],
    },
  ],
})
export class GraphQLModule { }
