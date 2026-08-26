import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ConfigService } from '@app/shared/services/config.service';
import {
  DeliveryBookingConfirmation,
  DeliveryBookingEligibility,
  DeliveryBookingInput,
  DeliveryDayAvailability,
} from './models';

/**
 * Talks to techaid-server's public delivery-booking operations. These are the
 * unauthenticated `*Public` surface (no @PreAuthorize server-side), so we POST plain
 * GraphQL with HttpClient and send no Authorization header — deliberately NOT the
 * shared Apollo client, whose auth link would bounce an anonymous visitor to Auth0.
 */
const ELIGIBILITY_QUERY = `
  query DeliveryBookingEligibilityPublic($ctaReference: Long!) {
    deliveryBookingEligibilityPublic(ctaReference: $ctaReference) {
      eligible
      message
    }
  }
`;

const AVAILABILITY_QUERY = `
  query DeliveryAvailabilityPublic($ctaReference: Long) {
    deliveryAvailabilityPublic(ctaReference: $ctaReference) {
      date
      dayOfWeek
      dayLabel
      windows {
        spotsRemaining
        window { id name startTime endTime }
      }
    }
  }
`;

const SUBMIT_MUTATION = `
  mutation SubmitDeliveryBookingPublic($input: DeliveryBookingInput!) {
    submitDeliveryBookingPublic(input: $input) {
      id
      date
      dayLabel
      window { id name startTime endTime }
      address
      ctaReference
      confirmationSentTo
    }
  }
`;

interface GraphQlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { classification?: string } }[];
}

/**
 * Thrown when the GraphQL response contains an error. `classification` mirrors
 * `extensions.classification` from the server — `'BAD_REQUEST'` for deliberate
 * rejections (duplicate booking, rate limit, Turnstile, validation, etc.) whose
 * message is safe to show verbatim; anything else is an unexpected failure.
 */
export class BookingApiError extends Error {
  constructor(
    message: string,
    readonly classification?: string,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class BookingApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly config: ConfigService,
  ) {}

  private request<T>(query: string, variables?: Record<string, unknown>): Observable<T> {
    return this.http
      .post<GraphQlResponse<T>>(this.config.environment.graphql_endpoint, { query, variables })
      .pipe(
        map((response) => {
          if (response.errors && response.errors.length) {
            const error = response.errors[0];
            throw new BookingApiError(error.message, error.extensions?.classification);
          }
          if (!response.data) {
            throw new Error('No data returned from the server.');
          }
          return response.data;
        }),
      );
  }

  checkEligibility(ctaReference: number): Observable<DeliveryBookingEligibility> {
    return this.request<{ deliveryBookingEligibilityPublic: DeliveryBookingEligibility }>(
      ELIGIBILITY_QUERY,
      { ctaReference },
    ).pipe(map((data) => data.deliveryBookingEligibilityPublic));
  }

  getAvailability(ctaReference: number | null): Observable<DeliveryDayAvailability[]> {
    return this.request<{ deliveryAvailabilityPublic: DeliveryDayAvailability[] }>(
      AVAILABILITY_QUERY,
      { ctaReference },
    ).pipe(map((data) => data.deliveryAvailabilityPublic));
  }

  submitBooking(input: DeliveryBookingInput): Observable<DeliveryBookingConfirmation> {
    return this.request<{ submitDeliveryBookingPublic: DeliveryBookingConfirmation }>(
      SUBMIT_MUTATION,
      { input },
    ).pipe(map((data) => data.submitDeliveryBookingPublic));
  }
}
