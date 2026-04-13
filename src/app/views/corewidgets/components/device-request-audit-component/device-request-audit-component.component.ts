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
import { UntypedFormGroup } from '@angular/forms';
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
import { DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';

const QUERY_ENTITY = gql`
  query getDeviceRequestAuditTrail($id: Long!) {
    deviceRequestAudits(where: $id) {
      revision {
        id
        timestamp
        customUser
      }
      type
      entity {
        status
        clientRef
        details
        borough
        updatedAt
        createdAt
        isSales
        deviceRequestItems {
          phones
          tablets
          laptops
          allInOnes
          desktops
          commsDevices
          other
          broadbandHubs
        }
      }
    }
  }
`;

@Component({
  selector: 'device-request-audit-component',
  styleUrls: ['device-request-audit-component.scss'],
  templateUrl: './device-request-audit-component.html',
})
export class DeviceRequestAuditComponent {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {}

  @Input()
  set deviceRequestId(deviceRequestId: any) {
    this._deviceRequestId = deviceRequestId;
  }
  _deviceRequestId = -1;

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

  classes = {
    'LOGISTICS': 'dark',
    'TECHNICIAN': 'info',
    'ORGANISER': 'success'
  };

  statusTypes: any = DEVICE_REQUEST_STATUS;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'device-request-audit-component';

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
      ordering: false,
      info: false,
      paging: false,
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: false,
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
          id: this._deviceRequestId
        };

        queryRef.refetch(vars).then(
          (res) => {
            let data: any = {};
            if (res.data) {
              data = res['data']['deviceRequestAudits'];
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
        { width: '100px' },
        { width: '200px' }
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
