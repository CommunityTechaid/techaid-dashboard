import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ConfigService } from './config.service';
import { newRef, REF_HEADER } from '../utils/error-ref';

/**
 * Gives an `X-CTA-Ref` header (#381) to GraphQL requests that do not go through Apollo: the public
 * feature-flag, borough-availability and delivery-booking services post to the endpoint with
 * HttpClient directly. Apollo's own requests already carry their operation's ref (refHeaderLink in
 * error-ref.ts) and are left alone, so a ref is never replaced. These requests are not reported to
 * Application Insights here; their services handle their own errors.
 *
 * The `buildInfo` health probe (BackendStatusService) uses fetch, not HttpClient, and has no ref:
 * it is not a data operation and its failure is never shown as an error a visitor could quote.
 */
export const errorRefInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.method !== 'POST' || request.headers.has(REF_HEADER)
    || request.url !== inject(ConfigService).environment.graphql_endpoint) {
    return next(request);
  }
  return next(request.clone({ setHeaders: { [REF_HEADER]: newRef() } }));
};
