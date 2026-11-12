import { Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormControl, UntypedFormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { warnIfFormInvalid } from '@app/shared/utils';

import { RouterLink } from '@angular/router';

const QUERY_PERMISSIONS = gql`
query findRoles($page: PaginationInput, $userId: String!) {
  user(id: $userId) {
    id: userId
    roles(page:$page){
      totalElements: total
      number: start
      content: items {
        id
        name
        description
      }
    }
  }
}
`;

const CREATE_ROLES = gql`
mutation assignRoles($roleId: String!, $userIds: [String!]!) {
  assignRoles(roleId: $roleId, userIds: $userIds){
    id
  }
}
`;

const DELETE_ROLES = gql`
mutation removeRoles($userId: String!, $roleIds: [String!]!) {
  removeRoles(userId: $userId, roleIds: $roleIds){
     id: userId
  }
}
`;

const AUTOCOMPLETE_ROLES = gql`
query findAutocompleteRoles($term: String) {
  roles(page: {
    size: 50
  }, filter: $term){
    content : items {
     id
     name
     description
    }
  }
}
`;

@Component({
    selector: 'user-roles',
    styleUrls: ['user-roles.scss'],
    templateUrl: './user-roles.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule]
})
export class UserRolesComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: '', width: '15px', sortable: false },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};



  apis$: Observable<any>;
  apis: any[] = [];
  apiInput$ = new Subject<string>();
  apiLoading = false;
  appField: FormlyFieldConfig = {
    key: 'roleId',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: '',
      loading: this.apiLoading,
      typeahead: this.apiInput$,
      placeholder: 'Select a Role',
      multiple: false,
      searchable: true,
      items: this.apis,
      required: true
    },
  };


  fields: FormlyFieldConfig[] = [
    this.appField
  ];

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {
  }

  private _userId: number;
  @Input()
  set userId(str: number) {
    this._userId = str;
    this.grid()?.reload();
  }

  modal(content) {
    this.modalService.open(content, {
      size: 'lg',
      centered: false
    });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
  }

  ngOnInit() {
    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_PERMISSIONS,
        variables: {}
      });

    const apiRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_ROLES,
        variables: {
        }
      });

    this.apis$ = concat(
      of([]),
      this.apiInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.apiLoading = true),
        switchMap(term => from(apiRef.refetch({
          term: term,
          userId: this._userId,
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load roles for filter');
            return of([]);
          }),
          tap(() => this.apiLoading = false),
          switchMap(res => {
            const data = res['data']['roles']['content'].map(v => {
              return {
                label: `${v.name} (${v.description})`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub = this.apis$.subscribe(data => {
      this.appField.templateOptions['items'] = data;
    });


    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        userId: this._userId,
        term: q.term,
      });
      const data: any = res?.data?.['user']?.['roles'] || { totalElements: 0, content: [] };
      return { rows: data.content ?? [], total: data.totalElements ?? 0 };
    };
  }

  onLoadError(err: any) {
    this.toastr.warning(`
      <small>${err?.message}</small>
    `, 'GraphQL Error', {
        enableHtml: true,
        timeOut: 15000,
        disableTimeOut: true
      });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  assignRoles(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;

    this.apollo.mutate({
      mutation: CREATE_ROLES,
      variables: {
        userIds: [this._userId],
        roleId: data['roleId']
      }
    }).subscribe(data => {
      this.model = {};
      this.form.setValue({
        roleId: null,
      });
      this.form.markAsUntouched();
      this.form.markAsPristine();
      this.grid()?.reload();
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Assign Role Error', {
          enableHtml: true,
          timeOut: 15000
        });
    });
  }

  deleteRole(role: any) {
    this.apollo.mutate({
      mutation: DELETE_ROLES,
      variables: {
        userId: this._userId,
        roleIds: [role.id]
      }
    }).subscribe(res => {
      this.grid()?.reload();
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Deleting Role', {
          enableHtml: true
        });
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
