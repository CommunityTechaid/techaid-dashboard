import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';

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
  encapsulation: ViewEncapsulation.None,
  templateUrl: './user-index.html'
})
export class UserIndexComponent {
  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
  model = {};

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

  query(evt?: any, filter?: string) {
    if (filter === undefined) {
      filter = this.table.search();
    }

    if (evt) {
      let code = (evt.keyCode ? evt.keyCode : evt.which);
      if (code !== 13) {
        return;
      }
    }

    this.table.search(filter);
    this.table.ajax.reload();
  }

  ngOnInit() {
    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_USERS,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload();
      }
    });
    const sorted : any = {'name': 'name', 'loginsCount': 'logins_count', 'lastLogin': 'last_login'};
    this.dtOptions = {
      pagingType: 'full_numbers',
      dom:
        "<'row'<'col-sm-12 col-md-6'l>>" +
        "<'row'<'col-sm-12'tr>>" +
        "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
      pageLength: 5,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [1, 'desc'],
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: true,
      ajax: (params: any, callback) => {
        let sort = params.order.map(o => {
          return {
            key: sorted[`${this.dtOptions.columns[o.column].data}`],
            value: (o.dir == 'asc') ? 1 : -1
          }
        });

        const vars = {
          page: {
            sort: sort,
            size: params.length,
            page: 0,
          },
          term: params['search']['value']
        }

        if (this.table) {
          vars.page.page = Math.min(
            Math.max(0, Math.round(params.start / this.table.page.len())),
            this.table.page.info().pages
          )
        }

        queryRef.refetch(vars).then(res => {
          var data: any = {};
          if (res.data) {
            data = res['data']['users'];
            if (!this.total) {
              this.total = data['totalElements']
            }
            this.entities = data.content;
          }

          callback({
            draw: params.draw,
            recordsTotal: this.total,
            recordsFiltered: data['totalElements'],
            error: "",
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
            })
        });
      }, 
      columns: [
        { data: null, width: '15px', orderable: false},
        { data: 'name'},
        { data: 'loginsCount'},
        { data: 'lastLogin' }
      ]
    };
  }

  ngOnDestory() {
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
    for (let k in this.selections) {
      this.selected.push(this.selections[k]);
    }
  }
}
