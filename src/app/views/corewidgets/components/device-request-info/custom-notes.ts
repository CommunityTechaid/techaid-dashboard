import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';

const DELETE_NOTE = gql`
mutation deleteDeviceRequestNote($id: ID!) {
  deleteDeviceRequestNote(id: $id)
}
`;

@Component({
    selector: 'formly-field-device-request-notes',
    template: `
<div class="notes-list" style="max-height:350px; overflow-y:scroll">
    <div *ngFor="let note of to.notes" class="note-item ">
        <div style="border: solid 3px #e3e6f0" class="card">
            <div class="card-body" style="padding:10px">
                <span>{{ note.content }}</span>
                <div class="d-flex row justify-content-between">
                    <div class="d-flex col-9 flex-row align-items-center">
                        <span style="max-width:60%" class="small text-muted text-truncate  mb-0 ms-2" title="{{ note.volunteer }}"><em>{{ note.volunteer }}</em></span>
                        <span class="small text-muted mb-0"><em>&nbsp;({{ note.updated_at | date : "dd/MM/yy HH:mm" }})</em></span>
                    </div>
                    <div class="d-flex col-2 flex-row">
                        <button (click)="deleteDeviceRequestNote(note.id)" class="btn rounded-0" type="button" title="Delete"><i style="color: #c51616" class="fas fa-window-close fa-lg"></i></button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
 `,
})
export class FormlyCustomDeviceRequestNote extends FieldType {


    constructor(
        private toastr: ToastrService,
        private apollo: Apollo
    ) {
        super();
    }

    /* Delete note calls the delete mutation directly and reloads the page to refresh the listings. There might be a way to prevent reload but it's too complicated. Also KISS/YAGNI
     */
    deleteDeviceRequestNote(id: any) {
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
