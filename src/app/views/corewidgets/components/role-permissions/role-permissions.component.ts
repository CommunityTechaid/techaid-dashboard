import { Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { concat, Subject, of, forkJoin, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormControl, UntypedFormGroup, FormBuilder, Validators } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';


const QUERY_PERMISSIONS = gql`
query findPermissions($page: PaginationInput, $roleId: String!) {
  role(id: $roleId) {
    id
    name
    permissions(page: $page){
      totalElements: total
      number: start
      content: items {
        resourceServerId
        resourceServerName
        name
        description
      }
    }
  }
}
`;

@Component({
    selector: 'role-permissions',
    styleUrls: ['role-permissions.scss'],
    templateUrl: './role-permissions.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NativeTableComponent, NativeTableRowDirective]
})
export class RolePermissionsComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};


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

    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        roleId: this._roleId,
        term: q.term,
      });
      const data: any = res?.data?.['role']?.['permissions'] || { totalElements: 0, content: [] };
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
