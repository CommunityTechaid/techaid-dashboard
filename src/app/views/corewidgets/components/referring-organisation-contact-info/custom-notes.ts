import { Component, TemplateRef, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { DatePipe } from '@angular/common';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

const DELETE_NOTE = gql`
mutation deleteReferringOrganisationContactNote($id: ID!) {
  deleteReferringOrganisationContactNote(id: $id)
}
`;

@Component({
    selector: 'formly-field-referring-organisation-contact-notes',
    template: `
<div class="notes-list" style="max-height:350px; overflow-y:scroll">
  @for (note of to.notes; track note) {
    <div class="note-item ">
      <div style="border: solid 3px #e3e6f0" class="card">
        <div class="card-body" style="padding:10px">
          <span>{{ note.content }}</span>
          <div class="d-flex row justify-content-between">
            <div class="d-flex col-9 flex-row align-items-center">
              <span style="max-width:60%" class="small text-muted text-truncate  mb-0 ms-2" title="{{ note.volunteer }}"><em>{{ note.volunteer }}</em></span>
              <span class="small text-muted mb-0"><em>&nbsp;({{ note.updated_at | date:'medium' }})</em></span>
            </div>
            <div class="d-flex col-2 flex-row">
              <button (click)="confirmDeleteNote(note.id, confirmDelete)" class="btn rounded-0" type="button" title="Delete"><i style="color: #c51616" class="fas fa-window-close fa-lg"></i></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  }
</div>
<ng-template #confirmDelete let-c="close" let-d="dismiss">
  <div class="modal-header">
    <h4 class="modal-title">Are you absolutely sure?</h4>
  </div>
  <div class="modal-body">
    <small>
      <p>Are you really sure you want to delete this note? This cannot be undone!</p>
    </small>
  </div>
  <div class="modal-footer">
    <button type="button" class="btn btn-light btn-sm" (click)="c('Close click')">CANCEL</button>
    <button type="button" class="btn btn-danger btn-sm" (click)="deleteReferringOrganisationContactNote(pendingDeleteId); c('Close click')">YES, DELETE</button>
  </div>
</ng-template>
`,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [DatePipe]
})
export class FormlyCustomReferringOrganisationContactNote extends FieldType {
    private readonly cdr = inject(ChangeDetectorRef);

    pendingDeleteId: any;

    constructor(
        private toastr: ToastrService,
        private apollo: Apollo,
        private modalService: NgbModal
    ) {
        super();
    }

    confirmDeleteNote(id: any, content: TemplateRef<any>) {
        this.pendingDeleteId = id;
        this.modalService.open(content, { centered: true });
    }

    /* Delete calls the mutation directly, then drops the note from the list in place (no page reload).
     */
    deleteReferringOrganisationContactNote(id: any) {
        this.apollo.mutate<any>({
            mutation: DELETE_NOTE,
            variables: { id: id }
        }).subscribe(res => {
            this.toastr.info(`
          <small>Successfully deleted note</small>
          `, 'Deleted Note', {
                enableHtml: true
            });
            this.removeNote(id);
        }, err => {
            this.toastr.error(`
          <small>${err.message}</small>
          `, 'Error Deleting Note', {
                enableHtml: true
            });
        });
    }

    // Notes are append-only server rows: once deleteNote succeeds, the list is the old one minus that id.
    // Build a new array (never mutate: the parent's list derives from a frozen Apollo result).
    private removeNote(id: any) {
        this.to.notes = (this.to.notes || []).filter((n: any) => String(n.id) !== String(id));
        // Runs from the deleteNote callback: mark this field for check so the list repaints without zone.js (#115).
        this.cdr.markForCheck();
    }
}
