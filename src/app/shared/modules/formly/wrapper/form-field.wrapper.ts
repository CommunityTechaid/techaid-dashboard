import { Component, ViewChild, ViewContainerRef } from '@angular/core';
import { FieldWrapper, FormlyModule } from '@ngx-formly/core';

import { NgbTooltip, NgbPopover } from '@ng-bootstrap/ng-bootstrap';


@Component({
    selector: 'form-formly-wrapper-form-field',
    template: `
    <div class="form-group" [class.has-error]="showError">
      @if (to.label && to.hideLabel !== true) {
        <label [attr.for]="id">
          {{ to.label }} @if (to.required && to.hideRequiredMarker !== true) {
          *
        }
        @if (to.tooltip) {
          &nbsp;<i class="fa fa-info-circle" placement="right" ngbTooltip="{{to.tooltip}}"></i>
        }
        @if (to.popover && to.popover.text) {
          &nbsp;<i class="fa fa-question-circle" placement="{{to.popover.placement || 'top' }}" triggers="{{to.popover.triggers || 'mouseenter:mouseleave'}}" ngbPopover="{{to.popover.text}}" popoverTitle="{{to.popover.title}}"></i>
        }
      </label>
    }
    
    <ng-template #fieldComponent></ng-template>
    
    @if (showError) {
      <div class="invalid-feedback" [style.display]="'block'">
        <formly-validation-message [field]="field"></formly-validation-message>
      </div>
    }
    
    @if (to.description) {
      <small class="form-text text-muted">{{ to.description }}</small>
    }
    </div>
    `,
    imports: [NgbTooltip, NgbPopover, FormlyModule]
})
export class AppFormlyWrapperFormField extends FieldWrapper {
  @ViewChild('fieldComponent', { read: ViewContainerRef }) fieldComponent: ViewContainerRef;
}
