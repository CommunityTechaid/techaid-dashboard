import { Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { NgbModal, NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';


const QUERY_PERMISSIONS = gql`
query findPermissions($userId: String!, $page: PaginationInput) {
  user(id: $userId) {
    id: userId
    permissions(page:$page){
      totalElements: total
      number: start
      content: items {
        resourceServerId
        resourceServerName
        name
        description
      }
    }
    roles {
      content: items {
        name
        permissions {
          items {
            name
          }
        }
      }
    }
  }
}
`;

// The server identifies a permission by resourceServerId + name, but its
// PermissionInput binds all four fields as non-null, so send them all.
const REMOVE_PERMISSIONS = gql`
mutation removePermissions($userId: String!, $permissions: [PermissionInput!]!) {
  removePermissions(userId: $userId, permissions: $permissions){
    userId
  }
}
`;

@Component({
    selector: 'user-permissions',
    styleUrls: ['user-permissions.scss'],
    templateUrl: './user-permissions.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [NativeTableComponent, NativeTableRowDirective, NgbPopover]
})
export class UserPermissionsComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Assignment', sortable: false },
    { title: '', width: '15px', sortable: false },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];


  @Select(CoreWidgetState.query) search$: Observable<string>;

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {
  }

  private _userId: number;
  @Input()
  set userId(id: number) {
    this._userId = id;
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
    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_PERMISSIONS,
        variables: {}
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
      const data: any = res?.data?.['user']?.['permissions'] || { totalElements: 0, content: [] };
      const roles = {};
      (res?.data?.['user']?.['roles']?.['content'] || []).forEach(r => {
        (r?.['permissions']?.['items'] || []).forEach(p => {
          roles[p.name] = roles[p.name] || [];
          roles[p.name].push(r.name);
        });
      });
      // map + spread: Apollo v4 freezes the rows, never write to them.
      const rows = (data.content ?? []).map(row => {
        const rowRoles = roles[row.name] || [];
        return {
          ...row,
          roles: rowRoles,
          byRole: rowRoles.length > 0,
          mappedRoles: this.trimString(rowRoles.join(','), 150),
          direct: !roles[row.name],
        };
      });
      return { rows, total: data.totalElements ?? 0 };
    };
  }

  private trimString(str: string, length: number) {
    return str.length > length ? str.substring(0, length) + '...' : str;
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

  deletePermission(permission: any) {
    this.apollo.mutate({
      mutation: REMOVE_PERMISSIONS,
      variables: {
        userId: this._userId,
        permissions: [{
          resourceServerId: permission.resourceServerId,
          resourceServerName: permission.resourceServerName ?? '',
          name: permission.name,
          description: permission.description ?? ''
        }]
      }
    }).subscribe(res => {
      this.grid()?.reload();
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Removing Permission', {
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
