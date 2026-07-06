import { Component, OnInit, OnDestroy, TemplateRef } from '@angular/core';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';

import { ReactiveFormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

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
  @if (to.label) {
    <label>{{to.label}}</label>
  }
  <div class="kit-info-input d-flex w-100 align-items-center justify-content-between" style="background-color: {{ to.bgcolor || 'white' }}">
    <div style="font-size:smaller" class="d-flex">
  
      @if (to.type==='select') {
        <select [hidden]="!editable" (focusout)="toggleEdit()" [formControl]="formControl" [formlyAttributes]="field">
          @for (val of to.options; track val) {
            <option
              [value]="val.value" >
              {{val.label}}
            </option>
          }
        </select>
      }

      @if (to.type!=='select') {
        <input [hidden]="!editable" (focusout)="toggleEdit()" [type]="to.type" [formControl]="formControl" [formlyAttributes]="field">
      }
      @if (formControl.value != null && formControl.value !== '') {
        <span [hidden]="editable" class="pr-1"  [innerText]="formControl.value"></span>
      }
      @if (formControl.value == null || formControl.value === '') {
        <span [hidden]="editable" class="pr-1 pl-1">None</span>
      }
      @if (to.descriptor) {
        <span class="pr-1">{{to.descriptor }}</span>
      }
    </div>
    <div>
      @if (!to.readonly) {
        <div>
          <i (click)="confirmEditField(confirmEdit)" class="fas fa-edit fa-xs align-self-end"></i>
        </div>
      }


    </div>
  <ng-template #confirmEdit let-c="close" let-d="dismiss">
    <div class="modal-header">
      <h4 class="modal-title">Are you absolutely sure?</h4>
    </div>
    <div class="modal-body">
      <small>
        <p>Are you sure you want to edit this device information?</p>
      </small>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-light btn-sm" (click)="c('Close click')">CANCEL</button>
      <button type="button" class="btn btn-primary btn-sm" (click)="toggleEdit(); c('Close click')">YES, EDIT</button>
    </div>
  </ng-template>
  `,
    imports: [ReactiveFormsModule, FormlyModule]
})
export class FormlyCustomKitInfoType extends FieldType<FieldTypeConfig> implements OnInit, OnDestroy {
    editable = false;
    choice = false;
    private destroy$ = new Subject<void>();

    constructor(private modalService: NgbModal) {
      super();
    }

    toggleEdit(){
      this.editable = !this.editable
    }

    confirmEditField(content: TemplateRef<any>){
      this.modalService.open(content, { centered: true });
    }

    ngOnInit(){
      this.field.templateOptions.hidden = true;
      if (!this.field.templateOptions.type)
        this.field.templateOptions.type = "input";

      if (this.to.type === 'number') {
        this.formControl.valueChanges
          .pipe(takeUntil(this.destroy$))
          .subscribe(value => {
            if (value === '' || value === undefined) {
              if (this.formControl.value !== null) {
                this.formControl.setValue(null, { emitEvent: false, onlySelf: true });
              }
              return;
            }
            if (typeof value === 'string') {
              const parsed = parseInt(value, 10);
              const next = Number.isFinite(parsed) ? parsed : null;
              this.formControl.setValue(next, { emitEvent: false, onlySelf: true });
            }
          });
      }
    }

    ngOnDestroy(){
      this.destroy$.next();
      this.destroy$.complete();
    }
}