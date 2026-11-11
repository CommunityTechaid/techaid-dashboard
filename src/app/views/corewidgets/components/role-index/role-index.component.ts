import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, viewChild } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { NgbModal, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { RouterLink } from '@angular/router';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';

const QUERY_ROLES = gql`
query findAllRoles($page: PaginationInput!, $term: String) {
  roles(page: $page, filter: $term){
    totalElements: total
    number: start
    content: items {
     id
     name
     description
    }
  }
}
`;

interface RoleRow {
  id: number;
  name: string;
  description: string;
}

@Component({
    selector: 'role-index',
    styleUrls: ['role-index.scss'],
    templateUrl: './role-index.html',
    imports: [RouterLink, NativeTableComponent, NativeTableRowDirective, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleIndexComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<RoleRow>);
  sub: Subscription;
  selections = {};
  selected = [];
  @Select(CoreWidgetState.query) search$: Observable<string>;

  readonly columns: TableColumn[] = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
  ];

  private queryRef = this.apollo.watchQuery<any>({
    query: QUERY_ROLES,
    variables: {}
  });

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {
  }

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
  }

  /** Turns the table's query into the roles GraphQL variables; the shell drops stale answers. */
  readonly source: TableSource<RoleRow> = async (q) => {
    const res = await this.queryRef.refetch({
      page: {
        sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
        size: q.size,
        page: q.page,
      },
      term: q.term,
    });
    const data = res.data?.roles;
    return { rows: data?.content ?? [], total: data?.totalElements ?? 0 };
  };

  onLoadError(err: any) {
    this.toastr.warning(`
      <small>${err?.message}</small>
    `, 'GraphQL Error', {
        enableHtml: true,
        timeOut: 15000,
        disableTimeOut: true
      });
  }

  ngOnInit() {
    // The header search box. Ignored until the table exists, as before.
    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
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
