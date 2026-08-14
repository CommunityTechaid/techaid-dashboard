import { Component, ViewChild, ViewEncapsulation, Input, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Observable, Subscription, from, Subject, concat, of } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { DEVICE_REQUEST_STATUS_LABELS, DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP, ALL_BOROUGHS } from '@app/shared/utils';
import { DatePipe } from '@angular/common';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { RouterLink } from '@angular/router';

/**
 * The value used for "borough was never captured".
 *
 * A sentinel rather than a real borough name: legacy requests store an EMPTY STRING, not null
 * (`borough = data.borough ?: ""` on the server), and so does anything staff create in the admin
 * form, where the field is read-only. Without an explicit option for them, a borough filter would
 * silently hide a large slice of the history and look like data loss.
 */
export const BOROUGH_NOT_RECORDED = '__not_recorded__';

/**
 * Options for the borough filter — every borough the codebase knows about, not just the ones
 * currently accepted. A filter has to match historical records, including Tower Hamlets requests
 * taken during the pilot if the borough is later switched off. That is exactly what ALL_BOROUGHS
 * exists for; `supportedBoroughs()` is the wrong list here.
 */
const BOROUGH_FILTER_OPTIONS = [
  ...ALL_BOROUGHS.map(b => ({ label: b.name, value: b.name })),
  { label: 'Not recorded', value: BOROUGH_NOT_RECORDED },
];

const QUERY_ENTITY = gql`
query findAllDeviceRequests($page: PaginationInput, $numericterm: Long, $term: String, $filter: DeviceRequestWhereInput!) {
  deviceRequestConnection(page: $page, where: {
      OR: [
        {
          AND: [ { clientRef: { _contains: $term } }, $filter ]
        }
        {
          AND: [ { id: { _eq: $numericterm } }, $filter ]
        }
        {
          AND: [ { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } }, $filter ]
        }
        {
          AND: [ { referringOrganisationContact: { fullName: { _contains: $term } } }, $filter ]
        }
      ]
  }){
    totalElements
    content{
     id
     status
     clientRef
     borough
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
     kits {
      id
      type
     }
     referringOrganisationContact {
      id
      fullName
      referringOrganisation {
        id
        name
      }
     }
     isPrepped
     createdAt
     updatedAt
    }
  }
}
`;

@Component({
    selector: 'app-device-request-index',
    templateUrl: './device-request-index.component.html',
    styleUrls: ['./device-request-index.component.scss'],
    imports: [AppGridDirective_1, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe]
})
export class DeviceRequestIndexComponent implements OnInit, OnDestroy, AfterViewInit {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }
  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
  @Select(CoreWidgetState.query) search$: Observable<string>;

  statusTypes: any = DEVICE_REQUEST_STATUS;


  filter: any = {};
  filterCount = 0;
  filterModel: any = {is_sales: [false]};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterDeviceTypes = DEVICE_TYPES;
  filterFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Status of the request',
            items: DEVICE_REQUEST_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        {
          key: 'is_sales',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [false],
          templateOptions: {
            type: 'array',
            label: 'Filter by Commercial Sales?',
            options: [
              {label: 'Non-commercial', value: false },
              {label: 'Commercial', value: true },
            ],
            required: false,
          }
        },
        {
          key: 'device_type',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Device Type?',
            options: this.filterDeviceTypes,
            required: false,
          }
        },
        {
          key: 'is_prepped',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Prepped Status?',
            options: [
              {label: 'Not Prepped', value: false },
              {label: 'Prepped', value: true },
            ],
            required: false,
          }
        },
        {
          key: 'borough',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Borough?',
            options: BOROUGH_FILTER_OPTIONS,
            required: false,
          }
        },
      ]
    }
  ];

  @Input()
  tableId = 'device-request-index';

  applyFilter(data) {
    const filter = {};
    let count = 0;
    const deviceTypeLookup = DEVICE_TYPE_LOOKUP;

    if (data.status && data.status.length) {
      count = count + data.status.length;
      filter['status'] = {'_in': data.status };
    }

    if (data.is_sales && data.is_sales.length) {
      count += data.is_sales.length;
      filter['isSales'] = {_in: data.is_sales};
    }

    if (data.device_type && data.device_type.length) {
      const deviceRequestItems = { };

      data.device_type.forEach(devType => {
        if(devType in deviceTypeLookup) {
          count++;
          deviceRequestItems[deviceTypeLookup[devType]] = { _gt: 0 };
        }
      })
      filter['deviceRequestItems'] = deviceRequestItems;
    }

    if (data.is_prepped && data.is_prepped.length) {
      count += data.is_prepped.length;
      filter['isPrepped'] = {_in: data.is_prepped};
    }

    // Borough. Selecting "Not recorded" has to reach rows holding an empty string AND any holding
    // null — the server only started defaulting the column to "" at some point, so both shapes
    // exist in the data. `_in` cannot express null, hence the OR; when no blank option is
    // selected the simple `_in` is used so the common case stays a single predicate.
    if (data.borough && data.borough.length) {
      count += data.borough.length;
      const named = data.borough.filter(b => b !== BOROUGH_NOT_RECORDED);
      const includeBlank = data.borough.includes(BOROUGH_NOT_RECORDED);

      if (includeBlank) {
        const alternatives: any[] = [{ borough: { _in: [''] } }, { borough: { _is_null: true } }];
        if (named.length) {
          alternatives.unshift({ borough: { _in: named } });
        }
        filter['OR'] = alternatives;
      } else {
        filter['borough'] = { _in: named };
      }
    }

    localStorage.setItem(`deviceRequestFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    // Reset the cached total so it is re-captured from the next response,
    // preventing recordsTotal from being stale (and smaller than recordsFiltered)
    // when a filter is active on the first load (e.g. restored from localStorage).
    this.total = 0;
    this.table.ajax.reload(null, false);
  }

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
    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
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
      pageLength: 10,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [0, 'desc'],
      serverSide: true,
      stateSave: true,
      /**
       * Discard a saved state that predates a column being added or removed.
       *
       * DataTables persists per-column state (visibility, widths, and the sort column INDEX) in
       * localStorage keyed by table id. Adding the Borough column shifts every index after it, so
       * a state saved before this change would restore a sort against the wrong column — or, with
       * a stale visibility array, break the table outright. Returning false discards it.
       *
       * This is the classic "the table is broken for me but fine in incognito" report: it never
       * reproduces in a fresh browser, and so never shows up in an e2e run either. Anyone changing
       * the column list again gets the same protection for free.
       */
      stateLoadParams: (settings: any, data: any) => {
        const expected = this.dtOptions.columns?.length ?? 0;
        if (data?.columns && expected && data.columns.length !== expected) {
          return false;
        }
        return true;
      },
      processing: true,
      searching: true,
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
          term: params['search']['value'],
          numericterm: isNaN(Number(params['search']['value'])) ? -1 : Number(params['search']['value']),
          filter: this.filter
        };
        console.log('vars', vars);
        queryRef.refetch(vars).then(res => {
          let data: any = {};
          if (res.data) {
            data = res['data']['deviceRequestConnection'];
            if (!this.total) {
              this.total = data['totalElements'];
            }
            this.entities = data.content.map(d => {
              const types: Record<string, number> = {};
              const kitIds: Record<string, string[]> = {};
              if (d.kits && d.kits.length) {
                d.kits.forEach(k => {
                  const typeMap: Record<string, string> = { 'SMARTPHONE': 'PHONES' };
                  const t = typeMap[k.type] || `${k.type}S`;
                  types[t] = (types[t] || 0) + 1;
                  kitIds[t] = kitIds[t] || [];
                  kitIds[t].push(k.id);
                });
              }
              return { ...d, types, kitIds };
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
        { data: 'id', width: '15px' },
        { data: null, orderable: false },
        { data: 'referringOrganisationContact.fullName' },
        { data: 'referringOrganisationContact.referringOrganisation.name' },
        // Borough sits beside Organisation — together they answer "who referred, and from where".
        // This array is positional against the <th> list in the template AND against the sort
        // mapping below (dtOptions.columns[o.column].data), so the two must be edited together or
        // the table silently sorts by the wrong field.
        { data: 'borough' },
        { data: 'clientRef' },
        { data: 'createdAt' },
        { data: 'updatedAt' },
        { data: 'status' },
        { data: null, orderable: false },
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
      try {
        this.filterModel = JSON.parse(localStorage.getItem(`deviceRequestFilters-${this.tableId}`)) || {is_sales: [false]};
      } catch (_) {
        this.filterModel = {is_sales: [false]};
      }

      try {
        this.applyFilter(this.filterModel);
        this.filterForm.patchValue(this.filterModel);
      } catch (_) {
      }
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
