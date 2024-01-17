import { Component, OnInit } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';

@Component({
  selector: 'formly-field-kit-info-input',
  styleUrls: ['kit-info.scss'],
  template: `
  <label *ngIf="to.label">{{to.label}}</label>
    <div class="kit-info-input d-flex w-100 align-items-end justify-content-center">
      <input [hidden]="!editable" type='input' [formControl]="formControl" [formlyAttributes]="field" [(ngModel)]="infoValue">      
      <span [hidden]="editable" class="pr-1"  [innerText]="infoValue"></span>
      <span class="pr-1" *ngIf="to.descriptor">{{to.descriptor}}</span>
      <i (click)="test()" class="fas fa-edit fa-xs"></i>
    </div>
  `,
})
export class FormlyCustomKitInfoType extends FieldType<FieldTypeConfig> {
//
    infoValue: string;
    editable: boolean = false;
    choice: boolean = false;
    test(){
        this.editable = !this.editable
    }

    ngOnInit(){
      this.field.templateOptions.hidden = true;
    }
}