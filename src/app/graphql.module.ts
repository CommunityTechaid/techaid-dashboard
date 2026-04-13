import { NgModule } from '@angular/core';
import { ApolloModule, APOLLO_OPTIONS } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { ApolloClientOptions, ApolloLink, InMemoryCache } from '@apollo/client/core';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { ConfigService } from '@app/shared/services/config.service';
import { AuthenticationService } from './shared/services/authentication.service';


export function createApollo(httpLink: HttpLink, config: ConfigService, authService: AuthenticationService): ApolloClientOptions<any> {
  const http = httpLink.create({
    uri: config.environment.graphql_endpoint
  });

  const asyncAuthLink = setContext((request, previous) => new Promise((success) => {
    authService.getTokenSilently$({ audience: config.environment.auth_audience }).subscribe(
      token => {
        success({ headers: { 'Authorization': `Bearer ${token}` } });
      },
      () => success({})
    );
  }));

  const errorHandler = onError(({ graphQLErrors, networkError }) => {
    // network errors are handled silently — lists will be empty without the API
  });

  return {
    link: errorHandler.concat(asyncAuthLink.concat(http)),
    cache: new InMemoryCache(),
  };
}

@NgModule({
  exports: [ApolloModule],
  providers: [
    {
      provide: APOLLO_OPTIONS,
      useFactory: createApollo,
      deps: [HttpLink, ConfigService, AuthenticationService],
    },
  ],
})
export class GraphQLModule { }
