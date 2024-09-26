import { Component, OnInit } from '@angular/core';
import { FieldType } from '@ngx-formly/core';

@Component({
  selector: 'formly-field-button',
  template: `
    <div>
      <button 
        style="width: 150px" [class]="to.className"
        [type]="to.type"
        [disabled]="to.disabled" 
        [ngClass]="'btn btn-' + to.btnType" 
        (click)="onClick($event)">
          <small>{{ to.text }}</small>
      </button>
    </div>
  `,
})
export class FormlyFieldButton extends FieldType implements OnInit  {

  
  ngOnInit() {
    this.to.className = this.to.className || "btn btn-primary btn-sm p-2";
  }


  onClick($event: Event) {
    if (this.to.onClick) {
      this.to.onClick($event);
    }
  }
}