import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';


const UPDATE_NOTE = gql`
mutation updateNote($data: UpdateNoteInput!) {
  updateNote(data: $data){
      content
      volunteer
      createdAt
      updatedAt
      id
  }
}
`;

const DELETE_NOTE = gql`
mutation deleteNote($id: ID!) {
  deleteNote(id: $id)
}
`;

@Component({
    selector: 'formly-field-notes',
    template: `
  <div class="notes-list">
  <div *ngFor="let note of to.notes" class="note-item">
  <span>{{ note.volunteer }}</span> <br>
  <span>{{ note.updated_at | date : "dd/MM/yy HH:mm" }}</span> <br>
  <span>{{ note.content }}</span>
    <div class="actions">
      <button (click)="updateNote({content: 'Updated note', id: note.id})">Edit</button>
      <button (click)="deleteNote(note.id)">Delete</button>
    </div>
  </div>
</div>
 `,
})
export class FormlyCustomNote extends FieldType {


    constructor(
        private toastr: ToastrService,
        private apollo: Apollo
    ) {
        super();
    }

    //todo edit to remove reloading and instead do a subscribe and refresh thingy to eliminate unecessary reloading
    updateNote(data: any) {

        this.apollo.mutate({
            mutation: UPDATE_NOTE,
            variables: {
                data: data
            }
        }).subscribe(res => {
            this.toastr.info(`
          <small>Successfully updated note</small>
          `, 'Updated Note', {
                enableHtml: true
            });
            location.reload();
        }, err => {
            this.toastr.error(`
          <small>${err.message}</small>
          `, 'Update Error', {
                enableHtml: true
            });
        });
    }

    //todo edit to remove reloading and instead do a subscribe and refresh thingy to eliminate unecessary reloading
    deleteNote(id: any) {
        this.apollo.mutate<any>({
            mutation: DELETE_NOTE,
            variables: { id: id }
        }).subscribe(res => {
            this.toastr.info(`
          <small>Successfully deleted note</small>
          `, 'Deleted Note', {
                enableHtml: true
            });
            location.reload();
        }, err => {
            this.toastr.error(`
          <small>${err.message}</small>
          `, 'Error Deleting Note', {
                enableHtml: true
            });
        });
    }
}
