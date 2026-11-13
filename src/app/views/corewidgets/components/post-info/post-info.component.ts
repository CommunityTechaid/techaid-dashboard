import { Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject, signal } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
import { NgbModal, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { warnIfFormInvalid } from '@app/shared/utils';
import { toastError, toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
query findPost($id: Long!) {
  post(where: {
    id: {
      _eq: $id
    }
  }){
     id
     title
     slug
     secured
     content
     published
     createdAt
     updatedAt
  }
}
`;

const UPDATE_ENTITY = gql`
mutation updatePost($data: UpdatePostInput!) {
  updatePost(data: $data){
     id
     content
     slug
     title
     secured
     published
     createdAt
     updatedAt
  }
}
`;

const DELETE_ENTITY = gql`
mutation deletePost($id: ID!) {
  deletePost(id: $id)
}
`;

@Component({
    selector: 'post-info',
    styleUrls: ['post-info.scss'],
    templateUrl: './post-info.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [RouterLink, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, ReactiveFormsModule, FormlyModule, NgbNavOutlet]
})
export class PostInfoComponent implements OnInit, OnDestroy {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }
  sub: Subscription;
  // The formly `model` is reassigned from Apollo callbacks and must stay a plain object: mark for
  // check so the form repaints without zone.js (#115). Keeps this component Eager.
  private readonly cdr = inject(ChangeDetectorRef);
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {};
  model = {};
  // A signal so the delete-confirmation modal (its own view root) also sees an async update.
  readonly entityName = signal<string | undefined>(undefined);
  entityId: number;
  fields: FormlyFieldConfig[] = [
    {
      key: 'title',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Title',
        placeholder: '',
        // updatePost's title and slug are String! + @NotBlank on the server: an emptied field used to
        // send '' and fail with a raw server error. Required here, as on the create form (post-index).
        required: true
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'slug',
          type: 'input',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Slug',
            description: 'The url to the post',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'published',
          type: 'checkbox',
          className: 'col-md-6',
          defaultValue: true,
          templateOptions: {
            label: 'Published?',
            description: 'Unpublished Posts will not be available',
            placeholder: '',
            required: false
          }
        },
        {
          key: 'secured',
          type: 'checkbox',
          className: 'col-md-6',
          defaultValue: false,
          templateOptions: {
            label: 'Secured?',
            description: 'Secured pages are only visible to logged in users',
            placeholder: '',
            required: false
          }
        },
      ]
    },
    {
      key: 'content',
      type: 'htmleditor',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Content',
        placeholder: '',
        rows:  20,
        required: false
      }
    },
  ];

  private queryRef = this.apollo
    .watchQuery({
      query: QUERY_ENTITY,
      variables: {}
    });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {
    // Apollo v4 freezes query results; Formly writes into its model, so bind a copy (#219).
    // Every form key is a top-level scalar, so a shallow copy is enough.
    return { ...data };
  }

  private fetchData() {
    if (!this.entityId) {
      return;
    }

    this.queryRef.refetch({
      id: this.entityId
    }).then(res => {
      this.cdr.markForCheck();
      if (res.data && res.data['post']) {
        const data = res.data['post'];
        this.model = this.normalizeData(data);
        this.entityName.set(this.model['title']);
      } else {
        this.model = {};
        this.entityName.set('Not Found!');
      }
    }, err => {
      toastWarning(this.toastr, err, 'GraphQL Error', { timeOut: 15000, disableTimeOut: true });
    });
  }

  ngOnInit() {
    this.sub = this.activatedRoute.params.subscribe(params => {
      this.entityId = +params['postId'];
      this.fetchData();
    });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  updateEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    data.id = this.entityId;
    this.apollo.mutate({
      mutation: UPDATE_ENTITY,
      variables: {
        data
      }
    }).subscribe(res => {
      this.cdr.markForCheck();
      this.model = this.normalizeData(res.data['updatePost']);
      this.entityName.set(this.model['title']);
      this.toastr.info(`
      <small>Successfully updated Post ${this.entityName()}</small>
      `, 'Updated Post', {
          enableHtml: true
        });
    }, err => {
      toastError(this.toastr, err, 'Update Error');
    });
  }

  deleteEntity() {
    this.apollo.mutate<any>({
      mutation: DELETE_ENTITY,
      variables: { id: this.entityId }
    }).subscribe(res => {
      if (res.data.deletePost) {
        this.toastr.info(`
        <small>Successfully deleted Post ${this.entityName()}</small>
        `, 'Post Deleted', {
            enableHtml: true
          });
        this.router.navigate(['/dashboard/posts']);
      }
    }, err => {
      toastError(this.toastr, err, 'Error Deleting Post');
    });
  }
}
