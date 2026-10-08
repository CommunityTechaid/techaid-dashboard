import { Component, ViewChild, ViewEncapsulation, Input, OnInit, OnDestroy, AfterViewInit, ChangeDetectionStrategy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal, NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { LatestDraw } from '@app/shared/utils';


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
    imports: [AppGridDirective_1, NgbPopover]
})
export class UserPermissionsComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Drops out-of-order ajax responses — see LatestDraw. */
  private readonly draws = new LatestDraw();

  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];


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
    if (this.table) {
      this.table.ajax.reload(null, false);
    }
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

  query(evt?: any, filter?: string) {
    if (filter === undefined) {
      filter = this.table.search();
    }

    if (evt) {
      const code = (evt.keyCode ? evt.keyCode : evt.which);
      if (code !== 13) {
        return;
      }
    }

    this.table.search(filter);
    this.table.ajax.reload(null, false);
  }

  ngOnInit() {
    this.sub = this.search$.subscribe(query => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_PERMISSIONS,
        variables: {}
      });

    this.dtOptions = {
      pagingType: 'full_numbers',
      dom:
        '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
        '<\'row\'<\'col-sm-12\'tr>>' +
        '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      pageLength: 10,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [1, 'desc'],
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: true,
      ajax: (params: any, callback) => {
        const drawToken = this.draws.start();
        const sort = params.order.map(o => {
          return {
            key: this.dtOptions.columns[o.column].data,
            value: o.dir
          };
        });

        const vars = {
          page: {
            sort: sort,
            size: params.length,
            page: Math.round(params.start / params.length),
          },
          userId: this._userId,
          term: params['search']['value']
        };


        queryRef.refetch(vars).then(res => {
          if (this.draws.isStale(drawToken)) {
            return;
          }
          let data: any = {};
          if (res && res.data) {
            data = res['data']?.['user']?.['permissions'] || { totalElements: 0, content: [] };
            if (!this.total) {
              this.total = data['totalElements'];
            }
            const roles = {};
            (res['data']?.['user']?.['roles']?.['content'] || []).forEach(r => {
              (r?.['permissions']?.['items'] || []).forEach(p => {
                roles[p.name] = roles[p.name] || [];
                roles[p.name].push(r.name);
              });
            });

            this.entities = data.content.map(row => {
              const rowRoles = roles[row.name] || [];
              return {
                ...row,
                roles: rowRoles,
                byRole: rowRoles.length > 0,
                mappedRoles: this.trimString(rowRoles.join(','), 150),
                direct: !roles[row.name],
              };
            });
          }

          callback({
            draw: params.draw,
            recordsTotal: this.total,
            recordsFiltered: data['totalElements'],
            error: '',
            data: []
          });
        }, err => {
          callback({
            draw: params.draw,
            recordsTotal: this.total || 0,
            recordsFiltered: 0,
            error: err.message,
            data: []
          });

          this.toastr.warning(`
            <small>${err.message}</small>
          `, 'GraphQL Error', {
              enableHtml: true,
              timeOut: 15000,
              disableTimeOut: true
            });
        });
      },
      columns: [
        { data: 'name' },
        { data: 'description' },
        { data: 'null', orderable: false },
        { data: null, width: '15px', orderable: false }
      ]
    };
  }

  private trimString(str: string, length: number) {
    return str.length > length ? str.substring(0, length) + '...' : str;
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  ngAfterViewInit() {
    this.grid.dtInstance.then(tbl => {
      this.table = tbl;
    });
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
      this.table.ajax.reload(null, false);
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
