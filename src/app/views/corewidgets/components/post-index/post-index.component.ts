import { ChangeDetectionStrategy, Component, viewChild, Input, OnInit, OnDestroy } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormControl, UntypedFormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { warnIfFormInvalid } from '@app/shared/utils';
import { toastError, toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
query findAllPosts($page: PaginationInput,, $term: String) {
  postsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          slug: {
            _contains: $term
          }
        },
        {
          title: {
            _contains: $term
          }
        },
        {
          content: {
            _contains: $term
          }
        }
      ]
    }
  }){
    totalElements
    content{
     id
     slug
     title
     published
     createdAt
     updatedAt
    }
  }
}
`;

const CREATE_ENTITY = gql`
mutation createPost($data: CreatePostInput!) {
  createPost(data: $data){
     id
     slug
     title
     published
     createdAt
     updatedAt
  }
}
`;

@Component({
    selector: 'post-index',
    styleUrls: ['post-index.scss'],
    templateUrl: './post-index.html',
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush; the table shell is signal-based and repaints itself, no markForCheck needed (#113).
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PostIndexComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false },
    { title: 'Post', key: 'slug' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Status', key: 'published', width: '30px' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};

  @Select(CoreWidgetState.query) search$: Observable<string>;

  fields: FormlyFieldConfig[] = [
    {
      key: 'title',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Page Title',
        placeholder: '',
        required: true
      }
    },
    {
      key: 'slug',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Url',
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
  ];

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'post-index';

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
  }

  ngOnInit() {
    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY,
        variables: {}
      });


    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(x => ({ key: x.key, value: x.dir })),
          size: q.size,
          page: q.page,
        },
        term: q.term,
      });
      const data = res.data?.['postsConnection'];
      return { rows: data?.content ?? [], total: data?.totalElements ?? 0 };
    };
  }

  onLoadError(err: any) {
    toastWarning(this.toastr, err, 'GraphQL Error', { timeOut: 15000, disableTimeOut: true });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  createEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    data.content = '';
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.grid()?.reload();
    }, err => {
      toastError(this.toastr, err, 'Create Post Error', { timeOut: 15000 });
    });
  }


  select(row?: any) {
    if (row) {
      if (this.selections[row.id]) {
        delete this.selections[row.id];
      } else {
        this.selections[row.id] = row;
      }
    }

    this.selected = [];
    for (const k in this.selections) {
      this.selected.push(this.selections[k]);
    }
  }
}
