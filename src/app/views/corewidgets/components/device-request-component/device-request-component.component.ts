import { Component, ViewChild, ViewEncapsulation, Input } from '@angular/core';
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
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP } from '@app/shared/utils';
import { NgIf, NgFor, DatePipe } from '@angular/common';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { RouterLink } from '@angular/router';

const QUERY_ENTITY = gql`
query findAllOrgs(
  $page: PaginationInput,
  $where: DeviceRequestWhereInput!,
  $term: String,
  $filter: DeviceRequestWhereInput!) {
  deviceRequestConnection(page: $page, where: {
    AND: [$where, $filter]
    OR: [
      {
        referringOrganisationContact: { phoneNumber: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { fullName: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { email: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        clientRef: { _contains: $term }
        AND: [$where, $filter]
      }
    ]

  }){
    totalElements
    content{
      id
      status
      clientRef
      referringOrganisationContact {
        id
        phoneNumber
        fullName
        email
        address
        referringOrganisation {
          id
          name
        }
      }
      createdAt
      updatedAt
      details
      kitCount
      kits {
        type
      }
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
    selector: 'device-request-component',
    styleUrls: ['device-request-component.component.scss'],
    templateUrl: './device-request-component.component.html',
    imports: [NgIf, AppGridDirective_1, NgFor, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe]
})
export class DeviceRequestComponent {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) { }

  @Input()
  set where(where: any) {
    this._where = where;
    if (this.table) {
      this.applyFilter(this.filterModel);
    }
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
  filterModel: any = {archived: [false]};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterDeviceTypes = DEVICE_TYPES;
  filterFields: Array<FormlyFieldConfig> = [
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
        // {
        //   key: 'accepts',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [],
        //   templateOptions: {
        //     label: 'Accepts',
        //     type: 'array',
        //     options: [
        //       {label: 'Laptop', value: 'LAPTOPS' },
        //       {label: 'Tablet', value: 'TABLETS' },
        //       {label: 'Smart Phone', value: 'PHONES' },
        //       {label: 'All In One (PC)', value: 'ALLINONES' },
        //       {label: 'Desktop', value: 'DESKTOPS' },
        //       {label: 'Connectivity Device', value: 'COMMSDEVICES' }
        //     ]
        //   }
        // },
        // {
        //   key: 'needs',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [],
        //   templateOptions: {
        //     label: 'Client needs',
        //     type: 'array',
        //     options: [
        //       {value: 'internet', label: 'Has no home internet'},
        //       {value: 'mobility' , label: 'Mobility issues'},
        //       {value: 'training', label: 'Training needs'}
        //     ]
        //   }
        // },
        // {
        //   key: 'archived',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [false],
        //   templateOptions: {
        //     type: 'array',
        //     label: 'Filter by Archived?',
        //     options: [
        //       {label: 'Active Requests', value: false },
        //       {label: 'Archived Requests', value: true },
        //     ],
        //     required: false,
        //   }
        // }
      ]
    }
  ];

  @Input()
  tableId = 'device-request-component';

  _where = {};

  applyFilter(data) {
    const filter = {};
    let count = 0;
    const deviceTypeLookup = DEVICE_TYPE_LOOKUP;


    // if (data.accepts && data.accepts.length) {
    //   count = count + data.accepts.length;
    //   filter['accepts'] = {'_in': data.accepts };
    // }

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


    // if (data.needs && data.needs.length) {
    //   count = count + data.needs.length;
    //   filter['needs'] = {'_in': data.needs };
    // }

    // if (data.archived && data.archived.length) {
    //   count += data.archived.length;
    //   filter['archived'] = {_in: data.archived};
    // }

    localStorage.setItem(`orgFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
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
          where: this.filter,
          term: params['search']['value'],
          filter: this._where || this.filter
        };

        queryRef.refetch(vars).then(res => {
          let data: any = {};
          if (res.data) {
            data = res['data']['deviceRequestConnection'];
            if (!this.total) {
              this.total = data['totalElements'];
            }
            data.content.forEach(d => {
              d.types = {};
              if (d.kits && d.kits.length) {
                d.kits.forEach(k => {
                  const typeMap: Record<string, string> = { 'SMARTPHONE': 'PHONES' };
                  const t = typeMap[k.type] || `${k.type}S`;
                  d.types[t] = d.types[t] || 0;
                  d.types[t]++;
                });
              }
            });
            this.entities = data.content;
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
        { data: 'kitCount'},
        { data: 'referringOrganisationContact.fullName' },
        { data: 'referringOrganisationContact.referringOrganisation.name' },
        { data: 'clientRef' },
        { data: 'createdAt'},
        { data: 'updatedAt' },
        { data: 'status' },
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
