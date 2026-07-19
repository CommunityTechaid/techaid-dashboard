import { Directive, ElementRef, HostListener, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgControl } from '@angular/forms';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';

/**
 * Cloudflare Worker that holds the Google Places API key server-side. Re-declared here
 * (rather than imported from the formly `PlaceInput` component) so the public booking
 * bundle never pulls in the formly module — see place.component.ts for the admin-side
 * sibling of this behaviour.
 */
const PLACES_PROXY_URL = 'https://cta-places-proxy.community-techaid.workers.dev';

export interface PlaceSuggestion {
  description: string;
  place_id?: string;
}

interface AutocompleteResponse {
  predictions?: PlaceSuggestion[];
}

/**
 * Assistive Google Places autocomplete for a plain reactive-forms input/textarea.
 * Purely a suggestion aid — free text always remains valid, nothing here blocks
 * submission or requires a selection. Attach to a host with `formControlName`/
 * `formControl` and read `suggestions` / call `select()` via the directive's
 * `exportAs` template reference (see details-step.component.html).
 *
 * Debounced 300ms, minimum 3 characters, mirrors the admin `PlaceInput` component but
 * skips its `/details` postcode lookup — here we always store the full description.
 */
@Directive({
  selector: '[appPlaceAutocomplete]',
  standalone: true,
  exportAs: 'appPlaceAutocomplete',
})
export class PlaceAutocompleteDirective implements OnDestroy {
  suggestions: PlaceSuggestion[] = [];

  private readonly http = inject(HttpClient);
  private readonly elementRef = inject(ElementRef<HTMLInputElement | HTMLTextAreaElement>);
  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly input$ = new Subject<string>();
  private readonly sub: Subscription;

  constructor() {
    this.sub = this.input$
      .pipe(
        debounceTime(300),
        switchMap((value) => {
          if (!value || value.trim().length < 3) {
            return of<PlaceSuggestion[]>([]);
          }
          return this.http
            .get<AutocompleteResponse>(`${PLACES_PROXY_URL}/autocomplete`, { params: { input: value } })
            .pipe(
              switchMap((response) => of(response.predictions ?? [])),
              // Free-typing must always work — swallow proxy/network failures to no
              // suggestions rather than surfacing an error.
              catchError(() => of<PlaceSuggestion[]>([])),
            );
        }),
      )
      .subscribe((suggestions) => (this.suggestions = suggestions));
  }

  @HostListener('input')
  onInput(): void {
    this.input$.next(this.elementRef.nativeElement.value);
  }

  @HostListener('blur')
  onBlur(): void {
    // Delay so a (mousedown) on a suggestion fires before the list is cleared.
    setTimeout(() => (this.suggestions = []), 200);
  }

  select(suggestion: PlaceSuggestion): void {
    this.suggestions = [];
    this.ngControl?.control?.setValue(suggestion.description);
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
