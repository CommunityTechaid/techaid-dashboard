import {ApolloModule, APOLLO_OPTIONS} from 'apollo-angular';
import {HttpLinkModule, HttpLink} from 'apollo-angular/http';
import {ApolloLink, Observable, InMemoryCache} from '@apollo/client/core';
import {onError} from '@apollo/client/link/error';
import {setContext} from '@apollo/client/link/context';
import { NgModule } from '@angular/core';




import { ConfigService } from '@app/shared/services/config.service';

import { AuthenticationService } from './shared/services/authentication.service';
import { mergeMap, catchError, map, flatMap, switchMap, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';



export function createApollo(httpLink: HttpLink, config: ConfigService, authService: AuthenticationService) {
  const http = httpLink.create({
    uri: config.environment.graphql_endpoint
  });


  const asyncAuthLink = setContext((request, previous) =>  new Promise((success, fail) => {
      authService.getTokenSilently$({audience: config.environment.auth_audience}).subscribe(
      token => {
        success({headers: {  'Authorization': `Bearer ${token}`}});
      },
      err => success({})
    );
  }));

  const errorHandler = onError(({ graphQLErrors, networkError, operation, forward }) => {
    if (networkError) {

    }
  });

  return {
    link: errorHandler.concat(asyncAuthLink.concat(http)),
    cache: new InMemoryCache(),
  };
}

@NgModule({
  exports: [ApolloModule, HttpLinkModule],
  providers: [
    {
      provide: APOLLO_OPTIONS,
      useFactory: createApollo,
      deps: [HttpLink, ConfigService, AuthenticationService],
    },
  ],
})
export class GraphQLModule { }
