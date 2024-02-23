import { Component, OnInit } from '@angular/core';
import { FieldType, FieldTypeConfig } from '@ngx-formly/core';

/*
This component is a custom made formly type. This is probably not the cleanest way to do things but I could not figure out quite a bit of things needed to make it work 
without resorting to such means. Here is a bit of explanation of how things work.

The template consists of an select fields, an input field (both hidden by default), a span with the value of the field (using ngModel. This might be deprecated) and a button.
Based on a template option "type", either the input field or select field is used. 
When the edit button is clicked, it toggles a variable called editable that hides the span and displays the input or the select (depending on what the type variable).
If this element loses focus, another event toggles the editable back, thereby hiding it and displaying the span with the current value. 

Template Options:

- type: can be 'select' if you want to have a select field instead of input field. Other possible values include all valid <input> 'type' attribute.
        If not defined, it defaults to 'input'
- options: Make sure you provide a list of options if you set the type as select. Example:
          [
              {label: 'title1', value: 'val1' },
              {label: 'title2', value: 'val2' }
          ]
- label: The label (duh!)
- descriptor: A span to display something after the value. Usefull for units like "GB"

Ideally, the input field should be dynamically rendered using custom selector but this gives errors that are beyond my comprehension. That said, this works well.  

 */
@Component({
  selector: 'formly-field-kit-info-input',
  styleUrls: ['kit-info.scss'],
  template: `
  <label *ngIf="to.label">{{to.label}}</label>
    <div class="kit-info-input d-flex w-100 align-items-center justify-content-between">
    <div style="font-size:smaller" class="d-flex">

      <select *ngIf="to.type=='select'" [hidden]="!editable" (focusout)="toggleEdit()" [formControl]="formControl" [formlyAttributes]="field" [(ngModel)]="infoValue">
        <option *ngFor="let val of to.options" 
          [value]="val.value" >
          {{val.label}}
        </option>
      </select>

      <input *ngIf="to.type!='select'" [hidden]="!editable" (focusout)="toggleEdit()" [type]="to.type" [formControl]="formControl" [formlyAttributes]="field" [(ngModel)]="infoValue">      
      <span *ngIf="infoValue != undefined" [hidden]="editable" class="pr-1"  [innerText]="infoValue"></span>
      <span *ngIf="infoValue == undefined" [hidden]="editable" class="pr-1 pl-1">None</span>
      <span class="pr-1" *ngIf="to.descriptor">{{to.descriptor }}</span>
    </div>
    <div>
      <i (click)="editField()" class="fas fa-edit fa-xs align-self-end"></i>
    </div>
      
      
    </div>
  `,
})
export class FormlyCustomKitInfoType extends FieldType<FieldTypeConfig> {
//
    infoValue: string;
    editable: boolean = false;
    choice: boolean = false;
    
    toggleEdit(){
      this.editable = !this.editable
    }

    editField(){
      if (confirm("Are you sure you want to edit device information?")){
        this.editable = !this.editable
      }
    }

    ngOnInit(){
      this.field.templateOptions.hidden = true;
      if (!this.field.templateOptions.type)
        this.field.templateOptions.type = "input";
    }
}