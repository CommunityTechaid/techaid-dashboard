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

const CREATE_ENTITY = gql`
mutation createDeviceRequest($data: CreateDeviceRequestInput!) {
  createDeviceRequest(data: $data){
     id
  }
}
`;

@Component({
  selector: 'device-request-component',
  styleUrls: ['device-request-component.component.scss'],
  templateUrl: './device-request-component.component.html'
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
          key: 'contact',
          type: 'input',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Primary Contact Name',
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
          key: 'email',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Primary Contact Email',
            type: 'email',
            pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            placeholder: '',
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.phoneNumber.length'
          }
        },
        {
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Primary Contact Phone Number',
            pattern: /\+?[0-9]+/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.email.length'
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
    {
      key: 'attributes.accepts',
      type: 'multicheckbox',
      className: '',
      defaultValue: [],
      templateOptions: {
        type: 'array',
        label: 'What types of devices are you looking for?',
        multiple: true,
        options: [
          {value: 'LAPTOPS', label: 'Laptops'},
          {value: 'PHONES', label: 'Phones'},
          {value: 'TABLETS', label: 'Tablets' },
          {value: 'ALLINONES', label: 'All In Ones' },
          {value: 'DESKTOPS', label: 'Desktops' },
          {value: 'COMMSDEVICES', label: 'Connectivity Devices' },
          {value: 'BROADBANDHUBS', label: 'Broadband Hubs' }
        ],
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
      hideExpression: '!model.attributes.accepts.length',
      fieldGroup: [
        {
          className: 'col-12',
          template: `
            <p>How many of the following items can you currently take?</p>
          `
        },
        {
          key: 'attributes.request.laptops',
          type: 'input',
          className: 'col-6',
          defaultValue: 0,
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'LAPTOP\') < 0',
          templateOptions: {
            min: 0,
            label: 'Laptops',
            addonLeft: {
              class: 'fas fa-laptop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.phones',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'PHONE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Phones',
            addonLeft: {
              class: 'fas fa-mobile-alt'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.tablets',
          type: 'input',
          className: 'col-6',
          defaultValue: 0,
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'TABLET\') < 0',
          templateOptions: {
            min: 0,
            label: 'Tablets',
            addonLeft: {
              class: 'fas fa-tablet-alt'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.allInOnes',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'ALLINONE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'All In Ones',
            addonLeft: {
              class: 'fas fa-desktop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.desktops',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'DESKTOP\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Desktops',
            addonLeft: {
              class: 'fas fa-desktop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.commsDevices',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'COMMSDEVICE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'SIM Cards',
            addonLeft: {
              class: 'fas fa-microchip'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.request.broadbandHubs',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'BROADBANDHUB\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Broadband Hubs',
            addonLeft: {
              class: 'fas fa-wifi'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        }
      ]
    },
    {
      key: 'attributes.alternateAccepts',
      type: 'multicheckbox',
      className: '',
      hideExpression: '!model.attributes.accepts.length || model.attributes.accepts.length == 4',
      defaultValue: [],
      templateOptions: {
        type: 'array',
        label: 'If none of the items listed above are available, would you be willing to consider any of the following?',
        multiple: true,
        options: [
          {value: 'LAPTOPS', label: 'Laptops'},
          {value: 'PHONES', label: 'Phones'},
          {value: 'TABLETS', label: 'Tablets' },
          {value: 'ALLINONES', label: 'All In Ones' },
          {value: 'DESKTOPS', label: 'Desktops' },
          {value: 'COMMSDEVICES', label: 'Connectivity Devices' },
          {value: 'BROADBANDHUBS', label: 'Broadband Hubs' }
        ],
        required: false
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': 'model.showErrorState',
        'templateOptions.options': (model, state) => {
          const opts = [
            {value: 'LAPTOPS', label: 'Laptops'},
            {value: 'PHONES', label: 'Phones'},
            {value: 'TABLETS', label: 'Tablets' },
            {value: 'ALLINONES', label: 'All In Ones' },
            {value: 'DESKTOPS', label: 'Desktops' },
            {value: 'COMMSDEVICES', label: 'Connectivity Devices' },
            {value: 'BROADBANDHUBS', label: 'Broadband Hubs' }
          ];
          const values = opts.filter(o => (model.attributes.accepts || []).indexOf(o.value) == -1);
          return values;
        }
      }
    },
    {
      fieldGroupClassName: 'row',
      hideExpression: '!model.attributes.alternateAccepts.length',
      fieldGroup: [
        {
          className: 'col-12',
          template: `
            <p>How many of the following alternate items are you willing to take?</p>
          `
        },
        {
          key: 'attributes.alternateRequest.laptops',
          type: 'input',
          className: 'col-6',
          defaultValue: 0,
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'LAPTOP\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'LAPTOP\') < 0',
          templateOptions: {
            min: 0,
            label: 'Laptops',
            addonLeft: {
              class: 'fas fa-laptop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.phones',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'PHONE\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'PHONE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Phones',
            addonLeft: {
              class: 'fas fa-mobile-alt'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.tablets',
          type: 'input',
          className: 'col-6',
          defaultValue: 0,
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'TABLET\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'TABLET\') < 0',
          templateOptions: {
            min: 0,
            label: 'Tablets',
            addonLeft: {
              class: 'fas fa-tablet-alt'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.allInOnes',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'ALLINONE\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'ALLINONE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'All In Ones',
            addonLeft: {
              class: 'fas fa-desktop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.desktops',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'DESKTOP\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'DESKTOP\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Desktops',
            addonLeft: {
              class: 'fas fa-desktop'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.commsDevices',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'COMMSDEVICE\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'COMMSDEVICE\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'SIM Cards',
            addonLeft: {
              class: 'fas fa-microchip'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        },
        {
          key: 'attributes.alternateRequest.broadbandHubs',
          type: 'input',
          className: 'col-6',
          hideExpression: 'model.attributes.accepts.toString().indexOf(\'BROADBANDHUB\') > -1 || model.attributes.alternateAccepts.toString().indexOf(\'BROADBANDHUB\') < 0',
          defaultValue: 0,
          templateOptions: {
            min: 0,
            label: 'Broadband Hubs',
            addonLeft: {
              class: 'fas fa-wifi'
            },
            type: 'number',
            placeholder: '',
            required: true
          }
        }
      ]
    },
  ];

  filter: any = {};
  filterCount = 0;
  filterModel: any = {archived: [false]};
  filterForm: FormGroup = new FormGroup({});
  filterDeviceTypes: any =[
    {value: 'LAPTOPS', label: 'Laptops'},
    {value: 'PHONES', label: 'Phones'},
    {value: 'TABLETS', label: 'Tablets' },
    {value: 'ALLINONES', label: 'All In Ones' },
    {value: 'DESKTOPS', label: 'Desktops' },
    {value: 'COMMSDEVICES', label: 'SIM Cards' },
    {value: 'BROADBANDHUBS', label: 'Broadband Hubs' },
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
    const deviceTypeLookup: Record<string, string> = {
      "LAPTOPS": "laptops",
      "PHONES": "phones",
      "TABLETS": "tablets" ,
      "ALLINONES": "allInOnes" ,
      "DESKTOPS": "desktops" ,
      "COMMSDEVICES": "commsDevices" ,
      "OTHER" : "other",
      "BROADBANDHUBS" : "broadbandHubs"
    }


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
        { data: 'status' },
        { data: 'kitCount'},
        { data: 'clientRef' },
        { data: 'referringOrganisationContact.referringOrganisation.name' },
        { data: 'referringOrganisationContact.fullName' },
        { data: 'createdAt'},
        { data: 'updatedAt' },
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

  createEntity(data: any) {
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.total = null;
      this.table.ajax.reload(null, false);
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Organisation Error', {
          enableHtml: true,
          timeOut: 15000
        });
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
