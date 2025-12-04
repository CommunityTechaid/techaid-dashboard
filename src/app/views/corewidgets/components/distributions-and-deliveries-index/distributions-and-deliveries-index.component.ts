import { Component, ViewChild, ViewEncapsulation, Input } from '@angular/core';
import { Observable, Subscription, from, Subject, concat, of } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { DEVICE_REQUEST_STATUS_LABELS, DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';

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
     collectionDate
     deviceRequestItems {
      phones
      tablets
      laptops
      allInOnes
      desktops
      commsDevices
      other
     }
     kits {
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
     createdAt
     updatedAt
    }
  }
}
`;

@Component({
  selector: 'distributions-and-deliveries-index',
  templateUrl: './distributions-and-deliveries-index.component.html',
  styleUrls: ['./distributions-and-deliveries-index.component.scss']
})
export class DistributionsAndDeliveriesIndexComponent {

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
  form: FormGroup = new FormGroup({});
  model = {};

  @Select(CoreWidgetState.query) search$: Observable<string>;

  statusTypes: any = DEVICE_REQUEST_STATUS;

  fields: Array<FormlyFieldConfig> = [
    {
      key: 'name',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Name',
        placeholder: '',
        required: true
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': 'model.showErrorState',
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Organisation Phone Number',
            pattern: /\+?[0-9]+/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.phoneNumber.length'
          }
        },
        {
          key: 'address',
          type: 'place',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Address',
            description: 'The address of the organisation',
            placeholder: '',
            postCode: false,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.address.length'
          }
        }
      ]
    },
  ];

  filter: any = {};
  filterCount = 0;
  filterModel: any = {is_sales: [false]};
  filterForm: FormGroup = new FormGroup({});
  filterDeviceTypes: any =[
    {value: 'LAPTOPS', label: 'Laptops'},
    {value: 'PHONES', label: 'Phones'},
    {value: 'TABLETS', label: 'Tablets' },
    {value: 'ALLINONES', label: 'All In Ones' },
    {value: 'DESKTOPS', label: 'Desktops' },
    {value: 'COMMSDEVICES', label: 'SIM Cards' },
    {value: 'OTHER', label: 'Other' }
  ];
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
      ]
    }
  ];

  @Input()
  tableId = 'distributions-and-deliveries-index';

  weekButtons: Array<{label: string, startDate: Date, endDate: Date, type: 'week'}> = [];
  statusButtons: Array<{label: string, statuses: string[], type: 'status'}> = [];
  activeFilter: string | null = null;

  generateWeekButtons() {
    const buttons = [];
    const today = new Date();

    // Find Monday of current week
    const currentDay = today.getDay();
    const diff = currentDay === 0 ? -6 : 1 - currentDay; // Adjust for Sunday (0) or other days
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    // Generate 4 week buttons
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date(monday);
      weekStart.setDate(monday.getDate() + (i * 7));

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

      buttons.push({
        label,
        startDate: weekStart,
        endDate: weekEnd,
        type: 'week' as const
      });
    }

    return buttons;
  }

  generateStatusButtons() {
    return [
      {
        label: 'Awaiting Completion',
        statuses: ['NEW', 'PROCESSING_EQUALITIES_DATA_COMPLETE', 'PROCESSING_COLLECTION_DELIVERY_ARRANGED', 'PROCESSING_ON_HOLD'],
        type: 'status' as const
      },
      {
        label: 'Completed',
        statuses: ['REQUEST_COMPLETED'],
        type: 'status' as const
      }
    ];
  }

  applyWeekFilter(button: {label: string, startDate: Date, endDate: Date}) {
    this.activeFilter = button.label;
    const filterData = {
      ...this.filterModel,
      collectionDateStart: button.startDate.toISOString(),
      collectionDateEnd: button.endDate.toISOString()
    };

    const filter = {};
    filter['collectionDate'] = {
      _gte: button.startDate.toISOString(),
      _lte: button.endDate.toISOString()
    };

    // Preserve existing filters
    if (this.filterModel.is_sales && this.filterModel.is_sales.length) {
      filter['isSales'] = {_in: this.filterModel.is_sales};
    }
    if (this.filterModel.device_type && this.filterModel.device_type.length) {
      const deviceRequestItems = {};
      const deviceTypeLookup: Record<string, string> = {
        "LAPTOPS": "laptops",
        "PHONES": "phones",
        "TABLETS": "tablets",
        "ALLINONES": "allInOnes",
        "DESKTOPS": "desktops",
        "COMMSDEVICES": "commsDevices",
        "OTHER": "other"
      };
      this.filterModel.device_type.forEach(devType => {
        if (devType in deviceTypeLookup) {
          deviceRequestItems[deviceTypeLookup[devType]] = { _gt: 0 };
        }
      });
      filter['deviceRequestItems'] = deviceRequestItems;
    }

    this.filter = filter;
    this.filterModel = filterData;
    this.table.ajax.reload(null, false);
  }

  applyStatusFilter(button: {label: string, statuses: string[]}) {
    this.activeFilter = button.label;
    const filterData = {
      ...this.filterModel,
      status: button.statuses
    };

    this.applyFilter(filterData);
  }

  clearQuickFilters() {
    this.activeFilter = null;
    const filterData = { ...this.filterModel };
    delete filterData['collectionDateStart'];
    delete filterData['collectionDateEnd'];
    delete filterData['status'];
    this.applyFilter(filterData);
  }

  applyFilter(data) {
    const filter = {};
    let count = 0;
    const deviceTypeLookup: Record<string, string> = {
      "LAPTOPS": "laptops",
      "PHONES": "phones",
      "TABLETS": "tablets" ,
      "ALLINONES": "allInOnes" ,
      "DESKTOPS": "desktops" ,
      "COMMSDEVICES": "commsDevices" ,
      "OTHER" : "other"
    }

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

    localStorage.setItem(`distributionsAndDeliveriesFilters-${this.tableId}`, JSON.stringify(data));
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
    // Generate filter buttons
    this.weekButtons = this.generateWeekButtons();
    this.statusButtons = this.generateStatusButtons();

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
            data.content.forEach(d => {
              d.types = {};
              if (d.kits && d.kits.length) {
                d.kits.forEach(k => {
                  const t = `${k.type}S`;
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
        { data: 'deviceRequestItems' },
        { data: 'referringOrganisationContact.fullName' },
        { data: 'referringOrganisationContact.referringOrganisation.name' },
        { data: 'clientRef' },
        { data: 'collectionDate' },
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
        this.filterModel = JSON.parse(localStorage.getItem(`distributionsAndDeliveriesFilters-${this.tableId}`)) || {is_sales: [false]};
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
