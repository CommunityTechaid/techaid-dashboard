import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';

@Component({
    selector: 'formly-field-create-device-request-note',
    template: `
  <div class="note-new" style="margin-bottom:20px">
    <label>Add a new note for this request</label>
    <textarea class="form-control" #newNoteContent rows="4" [name]=key [formControl]="formControl" [placeholder]=to.placeholder (keyup.enter)="$event.stopPropagation()"></textarea>
  </div>
 `,
})
export class FormlyCustomCreateDeviceRequestNote extends FieldType  {
}
