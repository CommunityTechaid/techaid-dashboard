import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, UntypedFormGroup, FormBuilder, Validators } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { RouterLink } from '@angular/router';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { LatestDraw } from '@app/shared/utils';


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

@Component({
    selector: 'role-index',
    styleUrls: ['role-index.scss'],
    templateUrl: './role-index.html',
    imports: [RouterLink, AppGridDirective_1, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu],
    // OnPush (hygiene 6.5, fanned out from the donor-index pilot, PR #111):
    // state only changes via the DataTables ajax callback, which resolves
    // outside the host template's event tree, so it calls cdr.markForCheck().
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoleIndexComponent implements OnInit, OnDestroy, AfterViewInit {
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
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};
  @Select(CoreWidgetState.query) search$: Observable<string>;

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef
  ) {
  }

  modal(content) {
    this.modalService.open(content, { centered: true });
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
    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ROLES,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    this.dtOptions = {
      pagingType: 'full_numbers',
      dom:
        '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
        '<\'row\'<\'col-sm-12\'tr>>' +
        '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      pageLength: 10,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [0, 'desc'],
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
          term: params['search']['value']
        };

        queryRef.refetch(vars).then(res => {
          if (this.draws.isStale(drawToken)) {
            return;
          }
          let data: any = {};
          if (res.data) {
            data = res['data']['roles'];
            if (!this.total) {
              this.total = data['totalElements'];
            }
            this.entities = data.content;
          }
          // The rows are rendered by Angular from `entities`, but this promise
          // resolves outside the host template's event tree — mark for check
          // or the table body never repaints under OnPush.
          this.cdr.markForCheck();

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
      ]
    };
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
