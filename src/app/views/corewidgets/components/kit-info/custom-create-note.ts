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
  <div class="note-new">
    <label>Add a new note for this device</label>
    <textarea #newNoteContent rows="4" [placeholder]=to.placeholder>
    </textarea>
    <br>
    <button (click)="createNote({content: newNoteContent.value, kitId: to.kitId})">Create Note</button>
  </div>
 `,
})
export class FormlyCustomCreateNote extends FieldType  {


    constructor(
        private toastr: ToastrService,
        private apollo: Apollo
    ) {
        super();
    }

    //todo edit to remove reloading and instead do a subscribe and refresh thingy to eliminate unecessary reloading
    createNote(data: any) {

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


   
}
