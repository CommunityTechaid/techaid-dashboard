import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';

const CREATE_NOTE = gql`
mutation createNote($data: CreateNoteInput!) {
  createNote(data: $data){
      content
      volunteer
      createdAt
      updatedAt
      id
  }
}
`;

@Component({
    selector: 'formly-field-create-note',
    template: `
  <div class="note-new" style="margin-bottom:20px">
    <label>Add a new note for this device</label>
    <textarea class="form-control" #newNoteContent rows="4" [name]=key [formControl]="formControl" [placeholder]=to.placeholder></textarea>
  </div>
 `,
})
export class FormlyCustomCreateNote extends FieldType  {


    /* constructor(
        private toastr: ToastrService,
        private apollo: Apollo
    ) {
        super();
    } */

  
    //Creation of note is handled by the save button of the UpdateKit mutation
    /* createNote(data: any) {

        this.apollo.mutate({
            mutation: CREATE_NOTE,
            variables: {
                data
            }
        }).subscribe(res => {
            this.toastr.info(`
          <small>Successfully created note</small>
          `, 'Created Note', {
                enableHtml: true
            });
            location.reload();
        }, err => {
            this.toastr.error(`
          <small>${err.message}</small>
          `, 'Create Error', {
                enableHtml: true
            });
        });
    }
 */

   
}
