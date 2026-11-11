import { ChangeDetectionStrategy, Component, viewChild, ViewEncapsulation, OnInit, OnDestroy } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, FormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { RouterLink } from '@angular/router';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { DatePipe } from '@angular/common';
import { AppInitialComponent } from '../../../../shared/components/app-initial/app-initial.component';

const QUERY_USERS = gql`
query findAllUsers($page: PaginationInput!, $term: String) {
  users(page: $page, filter: $term){
    totalElements: total
    number: start
    content: items{
     id: userId
     userId
     phoneNumber
     email
     name
     picture
     lastLogin
     loginsCount
    }
  }
}
`;

@Component({
    selector: 'user-index',
    styleUrls: ['user-index.scss'],
    templateUrl: './user-index.html',
    imports: [RouterLink, NativeTableComponent, NativeTableRowDirective, AppInitialComponent, DatePipe],
    // OnPush; the table shell is signal-based and repaints itself, no markForCheck needed (#113).
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserIndexComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false },
    { title: 'Name', key: 'name', sortable: false },
    { title: 'Logins', key: 'loginsCount', sortable: false },
    { title: 'Last Login', key: 'lastLogin' },
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

  modal(content) {
    this.modalService.open(content, { centered: true });
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

    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });
    const sorted: any = {'name': 'email', 'loginsCount': 'logins_count', 'lastLogin': 'last_login'};
    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          // This resolver wants the strings '1' / '-1', not 'asc' / 'desc' (issue #72, see the
          // architecture contract). Deliberately unlike the other tables: do not "consistency-fix".
          sort: q.sort.map(s => ({ key: sorted[s.key], value: s.dir === 'asc' ? '1' : '-1' })),
          size: q.size,
          page: q.page,
        },
        term: q.term,
      });
      const data = res.data?.['users'];
      return { rows: data?.content ?? [], total: data?.totalElements ?? 0 };
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
