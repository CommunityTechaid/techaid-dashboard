import { Component, OnInit } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';

@Component({
  selector: 'formly-field-kit-checkbox',
  styleUrls: ['kit-info.scss'],
  template: `
  <div lass="kit-checkbox d-flex w-100 align-items-center justify-content-between">
    <label class="kit-checkbox-label" *ngIf="to.label" for="{{id}}">{{to.label}}</label>
    <input type="checkbox" class="kit-checkbox-input" [formControl]="formControl" [formlyAttributes]="field" [(ngModel)]="value">
  </div>
  `,
})
export class FormlyCustomKitCheckboxType extends FieldType<FieldTypeConfig> {
    value: boolean;
}
