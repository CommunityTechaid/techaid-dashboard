import { Component, ViewChild, Input } from '@angular/core';
import {
  concat,
  Subject,
  of,
  Observable,
  Subscription,
  from,
} from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
  catchError,
} from 'rxjs/operators';
import { Select } from '@ngxs/store';
import 'datatables.net-responsive';
import 'datatables.net-rowreorder';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';

const QUERY_ENTITY = gql`
  query getAuditTrail($id: Long!) {
    kitAudits(where: $id) {
      revision {
        id
        timestamp
        customUser
      }
      type
      entity {
        id
        model
        age
        type
        status
        location
        updatedAt
        createdAt
      }
    }
  }
`;

@Component({
  selector: 'kit-audit-component',
  styleUrls: ['kit-audit-component.scss'],
  templateUrl: './kit-audit-component.html',
})
export class KitAuditComponent {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {}

  @Input()
  set kitId(kitId: any) {
    this._kitId = kitId;
  }
  _kitId = -1;

  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
  form: FormGroup = new FormGroup({});
  model = {};
  ages = {
     0: 'I don\'t know',
     1: 'Less than a year',
     2: '1 - 2 years',
     4: '3 - 4 years',
     5: '5 - 6 years',
     6: 'more than 6 years old'
  };

  classes = {
    'LOGISTICS': 'dark',
    'TECHNICIAN': 'info',
    'ORGANISER': 'success'
  };

  statusTypes: any = KIT_STATUS;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'kit-audit-component';

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
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
    const queryRef = this.apollo.watchQuery({
      query: QUERY_ENTITY,
      variables: {},
    });

    this.sub = this.search$.subscribe((query) => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    this.dtOptions = {
      pagingType: 'simple_numbers',
      dom:
        '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
        '<\'row\'<\'col-sm-12\'tr>>' +
        '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      pageLength: this.pageLength,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [1, 'desc'],
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: true,
      stateDuration: -1,
      ajax: (params: any, callback) => {
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
          id: this._kitId
        };

        queryRef.refetch(vars).then(
          (res) => {
            let data: any = {};
            if (res.data) {
              data = res['data']['kitAudits'];
              if (!this.total) {
                this.total = 10;
              }
              this.entities = data;
            }

            callback({
              draw: params.draw,
              recordsTotal: this.total,
              recordsFiltered: data['totalElements'],
              error: '',
              data: [],
            });
          },
          (err) => {
            callback({
              draw: params.draw,
              recordsTotal: this.total || 0,
              recordsFiltered: 0,
              error: err.message,
              data: [],
            });

            this.toastr.warning(
              `
            <small>${err.message}</small>
          `,
              'GraphQL Error',
              {
                enableHtml: true,
                timeOut: 15000,
                disableTimeOut: true,
              }
            );
          }
        );
      },
      columns: [
        { data: null, width: '15px', orderable: false },
        { data: 'model' },
        { data: 'donor' },
        { data: 'createdAt' },
        { data: 'updatedAt' },
        { data: 'age' },
        { data: 'type' },
        { data: 'status' },
      ],
    };
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  ngAfterViewInit() {
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
