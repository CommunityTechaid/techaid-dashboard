import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ReactiveFormsModule } from '@angular/forms';

@Component({
    selector: 'formly-field-create-note',
    template: `
  <div class="note-new" style="margin-bottom:20px">
    <label>Add a new note for this device</label>
    <textarea class="form-control" #newNoteContent rows="4" [name]=key [formControl]="formControl" [placeholder]=to.placeholder (keyup.enter)="$event.stopPropagation()"></textarea>
  </div>
 `,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [ReactiveFormsModule]
})
export class FormlyCustomCreateNote extends FieldType  {


  
    //Creation of note is handled by the save button of the UpdateKit mutation

   
}
