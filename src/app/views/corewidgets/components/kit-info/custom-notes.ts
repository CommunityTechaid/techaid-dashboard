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
<div class="notes-list" style="max-height:350px; overflow-y:scroll">
    <div *ngFor="let note of to.notes" class="note-item">
        <div class="card mb-4">
            <div class="card-body">
                <p>{{ note.content }}</p>
                <div class="d-flex justify-content-between">
                    <div class="d-flex flex-row align-items-center">
                        <p class="small text-muted mb-0 ms-2"><em>{{ note.volunteer }}</em></p>
                    </div>
                    <div class="d-flex flex-row align-items-center">
                        <p class="small text-muted mb-0">{{ note.updated_at | date : "dd/MM/yy HH:mm" }}</p>
                        <i class="mx-2 fa" (click)="deleteNote(note.id)" style="margin-top: -0.16rem; color:red">X</i>
                    </div>
                </div>
            </div>
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

    

    //Update note feature is note being implemented for the moment. It is not very important anyway. You can always just delete and recreate. 
    /*
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
 */
    /* Delete note calls the delete mutation directly and reloads the page to refresh the listings. There might be a way to prevent reload but it's too complicated. Also KISS/YAGNI 
     */
    deleteNote(id: any) {
        if(!confirm('Are you sure you want to delete this entry?')){
            return
        }
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