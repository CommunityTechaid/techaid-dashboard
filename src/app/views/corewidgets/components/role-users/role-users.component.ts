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

import { AppInitialComponent } from '../../../../shared/components/app-initial/app-initial.component';
import { RouterLink } from '@angular/router';
import { toastError, toastWarning } from '@app/shared/utils/error-toast';

const QUERY_USERS = gql`
query findAllUsers($page: PaginationInput, $roleId: String!) {
  role(id: $roleId){
    id
    users(page: $page){
      totalElements: total
      number: start
      content: items {
        id: userId
        name
        email
        userId
        phoneNumber
        picture
      }
    }
  }
}
`;

const CREATE_USER_ROLES = gql`
mutation assignRoles($roleId: String!, $userIds: [String!]!) {
  assignRoles(roleId: $roleId, userIds: $userIds){
    id
  }
}
`;

const DELETE_USER = gql`
mutation removeRoles($userId: String!, $roleIds: [String!]!) {
  removeRoles(userId: $userId, roleIds: $roleIds){
     id: userId
  }
}
`;

const QUERY_USER_ROLES = gql`
query typeaheadFindAllUsers($page: PaginationInput!, $term: String) {
  users(page: $page, filter: $term ){
    totalElements: total
    number: start
    content: items {
     name
     email
     phoneNumber
     id: userId
     userId
    }
  }
}
`;

@Component({
    selector: 'role-users',
    styleUrls: ['role-users.scss'],
    templateUrl: './role-users.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NativeTableComponent, NativeTableRowDirective, AppInitialComponent, RouterLink, ReactiveFormsModule, FormlyModule]
})
export class RoleUsersComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'Name', key: 'name', sortable: false },
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
    key: 'users',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: '',
      loading: this.apiLoading,
      typeahead: this.apiInput$,
      placeholder: 'Select a User',
      multiple: true,
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

  private _roleId = '';
  @Input()
  set roleId(str: string) {
    this._roleId = str;
    this.grid()?.reload();
  }

  private _roleName = '';
  @Input()
  set roleName(str: string) {
    this._roleName = str;
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
        query: QUERY_USERS,
        variables: {}
      });

    const apiRef = this.apollo
      .watchQuery({
        query: QUERY_USER_ROLES,
        variables: {}
      });

    this.apis$ = concat(
      of([]),
      this.apiInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.apiLoading = true),
        switchMap(term => from(apiRef.refetch({
          term: term,
          page: {

          }
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load users for filter');
            return of([]);
          }),
          tap(() => this.apiLoading = false),
          switchMap(res => {
            const data = res['data']['users']['content'].map(v => {
              return { label: `${v.name} (${v.email || v.phoneNumber})`, value: v.id };
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
          // The users resolvers want '1' / '-1', not 'asc' / 'desc' (issue #72).
          sort: q.sort.map(s => ({ key: s.key, value: s.dir === 'asc' ? '1' : '-1' })),
          size: q.size,
          page: q.page,
        },
        roleId: this._roleId,
        term: q.term,
      });
      const data: any = res?.data?.['role']?.['users'] || { totalElements: 0, content: [] };
      return { rows: data.content ?? [], total: data.totalElements ?? 0 };
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

  assignRoles(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    this.apollo.mutate({
      mutation: CREATE_USER_ROLES,
      variables: {
        roleId: this._roleId,
        userIds: data.users
      }
    }).subscribe(data => {
      this.model = {};
      this.grid()?.reload();
    }, err => {
      toastError(this.toastr, err, 'Assign User Roles Error', { timeOut: 15000 });
    });
  }

  deleteUser(user: any) {
    this.apollo.mutate({
      mutation: DELETE_USER,
      variables: {
        userId: user.userId,
        roleIds: [this._roleId]
      }
    }).subscribe(res => {
      this.grid()?.reload();
    }, err => {
      toastError(this.toastr, err, 'Error Deleting Role');
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
