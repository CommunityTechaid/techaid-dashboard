import { Component } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';

@Component({
  selector: 'formly-field-kit-info-input',
  styleUrls: ['kit-info.scss'],
  template: `
  <label *ngIf="to.label">{{to.label}}</label>
    <div class="kit-info-input d-flex w-100 align-items-end">
        <input readable=to.readable type="input" [formControl]="formControl" [formlyAttributes]="field">
        <i (click)="test()" class="fas fa-edit fa-xs"></i>
    </div>
  `,
})
export class FormlyCustomKitInfoType extends FieldType<FieldTypeConfig> {

    test(){
        console.log(this.field.templateOptions = {
            readonly: false
        })
    }
}