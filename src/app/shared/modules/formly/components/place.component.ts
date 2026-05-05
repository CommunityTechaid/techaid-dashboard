import { Component, OnInit, OnDestroy } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ReactiveFormsModule } from '@angular/forms';
import { NgIf, NgFor } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, switchMap, catchError } from 'rxjs/operators';

const PLACES_PROXY = 'https://cta-places-proxy.community-techaid.workers.dev';

@Component({
    selector: 'form-place',
    template: `
    <div class="input-group mb-2 position-relative">
        <input class="form-control"
          [formControl]="formControl"
          autocomplete="off"
          [class.is-invalid]="showError"
          placeholder="{{this.to.placeholder}}"
          (input)="onInput($event)"
          (blur)="hideSuggestions()"
        />
        <button class="btn btn-secondary" type="button" (click)="clear()">
          <i class="fa fa-times"></i>
        </button>
        <ul class="list-group position-absolute w-100 shadow" style="top:100%; z-index:9999" *ngIf="suggestions.length > 0">
          <li class="list-group-item list-group-item-action"
              style="cursor:pointer"
              *ngFor="let s of suggestions"
              (mousedown)="select(s)">
            {{ s.description }}
          </li>
        </ul>
    </div>
  `,
    imports: [ReactiveFormsModule, NgIf, NgFor]
})
export class PlaceInput extends FieldType implements OnInit, OnDestroy {
  suggestions: any[] = [];
  private input$ = new Subject<string>();
  private sub?: Subscription;

  constructor(private http: HttpClient) { super(); }

  ngOnInit() {
    this.sub = this.input$.pipe(
      debounceTime(300),
      switchMap(value => {
        if (!value || value.length < 3) return of({ predictions: [] });
        return this.http.get<any>(`${PLACES_PROXY}/autocomplete`, {
          params: { input: value }
        }).pipe(catchError(() => of({ predictions: [] })));
      })
    ).subscribe(r => this.suggestions = r.predictions || []);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  onInput(event: Event) {
    this.input$.next((event.target as HTMLInputElement).value);
  }

  hideSuggestions() {
    setTimeout(() => this.suggestions = [], 200);
  }

  select(suggestion: any) {
    this.suggestions = [];
    if (this.to.postCode) {
      this.http.get<any>(`${PLACES_PROXY}/details`, {
        params: { place_id: suggestion.place_id }
      }).subscribe(r => {
        const comps: any[] = r.result?.address_components || [];
        const pc = comps.find((a: any) => a.types.includes('postal_code'));
        this.formControl.setValue(pc?.long_name || suggestion.description);
      });
    } else {
      this.formControl.setValue(suggestion.description);
    }
  }

  clear() {
    this.formControl.setValue(null);
    this.suggestions = [];
  }
}
