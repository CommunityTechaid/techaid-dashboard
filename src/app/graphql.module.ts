import { NgModule } from '@angular/core';
import { APOLLO_OPTIONS } from 'apollo-angular';
import { HttpLink } from 'apollo-angular/http';
import { ApolloLink, InMemoryCache } from '@apollo/client/core';
import { ConfigService } from '@app/shared/services/config.service';
import { onError } from '@apollo/client/link/error';
import { AuthenticationService } from './shared/services/authentication.service';
import { setContext } from '@apollo/client/link/context';


export function createApollo(httpLink: HttpLink, config: ConfigService, authService: AuthenticationService) {
  const http = httpLink.create({
    uri: config.environment.graphql_endpoint
  });


  const asyncAuthLink = setContext((request, previous) =>  new Promise<any>((success, fail) => {
      authService.getTokenSilently$({authorizationParams: {audience: config.environment.auth_audience}}).subscribe(
      token => {
        success({headers: {  Authorization: `Bearer ${token}`}});
      },
      err => success({})
    );
  }));

  const errorHandler = onError(({ graphQLErrors, networkError, operation, forward }) => {
    if (networkError) {

    }
  });

  return {
    link: ApolloLink.from([errorHandler as any, asyncAuthLink, http as any]),
    cache: new InMemoryCache(),
  };
}

@NgModule({
  providers: [
    {
      provide: APOLLO_OPTIONS,
      useFactory: createApollo,
      deps: [HttpLink, ConfigService, AuthenticationService],
    },
  ],
})
export class GraphQLModule { }
