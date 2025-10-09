import { Component, ViewChild, Input } from '@angular/core';
import { concat, Subject, of, Observable, Subscription, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import 'datatables.net-responsive';
import 'datatables.net-rowreorder';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

const QUERY_ENTITY = gql`
  query findAllKits(
    $page: PaginationInput,
    $term: String,
    $where: KitWhereInput!
  ) {
    kitsConnection(
      page: $page,
      where: {
        AND: [
          $where,
          {
            OR: [
              { model: { _contains: $term } },
              { serialNo: { _contains: $term } },
              { id: { _contains: $term } },
              {
                attributes: {
                  filters: [
                    {
                      key: "notes",
                      _text: { _contains: $term }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    ){
      totalElements
      number
      content{
        id
        make
        model
        age
        type
        status
        location
        updatedAt
        createdAt
        donor {
          id
          name
          email
          phoneNumber
          donorParent {
            id
            name
            type
          }
        }
        deviceRequest {
          id
          referringOrganisationContact {
            id
            referringOrganisation {
              id
              name
            }
          }
        }
      }
    }
  }
`;

const CREATE_ENTITY = gql`
mutation createKits($data: CreateKitInput!) {
  createKit(data: $data){
    id
    type
    model
  }
}
`;

const CREATE_QUICK_ENTITY = gql`
mutation quickCreateKit($data: QuickCreateKitInput!) {
  quickCreateKit(data: $data){
    id
    type
    model
    donor {
      id
    }
  }
}
`;

const AUTOCOMPLETE_DEVICE_REQUESTS = gql`
query findAutocompleteDeviceRequests($term: String, $ids: [Long!]) {
  deviceRequestConnection(page: {
    size: 50
  }, where: {
    referringOrganisationContact: {referringOrganisation: { name: { _contains: $term } } }
    OR: [
    { id: { _in: $ids } },
    { id: { _contains: $term } },
    { referringOrganisationContact: { fullName: { _contains: $term } } },
    { referringOrganisationContact: { email: { _contains: $term } } }
    ]
  }){
    content  {
     id
     referringOrganisationContact {
      id
      email
      fullName
      phoneNumber
      referringOrganisation {
        id
        name
      }
     }
    }
  }
}
`;

const FIND_USERS = gql`
  query findUsers($deviceRequestIds: [Long!], $donorParentId: [Long!]) {
    deviceRequests(where: {
      id: { _in: $deviceRequestIds }
    }){
      id
      referringOrganisationContact {
        id
        fullName
        email
        phoneNumber
        referringOrganisation {
          id
          name
        }
      }
    }

    donorParents(where: {
      id: { _in: $donorParentId }
    }){
      id
      name
    }
  }
`;

const AUTOCOMPLETE_DONORS = gql`
query findAutocompleteDonors($term: String) {
  donorsConnection(page: {
    size: 50
  }, where: {
    name: { _contains: $term }
    OR: [
      { id: { _contains: $term } },
      { phoneNumber: { _contains: $term } },
      { email: { _contains: $term } }
    ]
  }){
    content  {
     id
     name
     email
     phoneNumber
    }
  }
}
`;

const AUTOCOMPLETE_DONOR_PARENTS = gql`
query findAutocompleteDonorParents($term: String, $id: Long) {
  donorParentsConnection(page: {
    size: 50
  }, where: {
    AND: {
      name: { _contains: $term },
      id: { _eq: $id },
      archived: { _eq: false }
    }
  }){
    content  {
      id
      name
      type
    }
  }
}
`;

@Component({
  selector: 'kit-index',
  styleUrls: ['kit-index.scss'],
  templateUrl: './kit-index.html'
})
export class KitIndexComponent {

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
  options: FormlyFormOptions = {
    formState: {
      donorParentVisible: false
    }
  };
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
  public user: User;
  @Select(UserState.user) user$: Observable<User>;
  isDonorParentAdmin = false;

  classes = {
    'LOGISTICS': 'dark',
    'TECHNICIAN': 'info',
    'ORGANISER': 'success'
  };

  statusTypes: any = KIT_STATUS;

  deviceRequests$: Observable<any>;
  deviceRequestInput$ = new Subject<string>();
  deviceRequestLoading = false;
  deviceRequestField: FormlyFieldConfig = {
    key: 'deviceRequestIds',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Assigned Device Request',
      description: 'Filter by assigned device request.',
      loading: this.deviceRequestLoading,
      typeahead: this.deviceRequestInput$,
      multiple: true,
      searchable: true,
      items: [],
      required: false
    },
  };

  donorParents$: Observable<any>;
  donorParentInput$ = new Subject<string>();
  donorParentLoading = false;
  donorParentField: FormlyFieldConfig = {
    key: 'donorParentId',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Parent Donor',
      description: 'The parent donor for this donor.',
      loading: this.donorParentLoading,
      typeahead: this.donorParentInput$,
      placeholder: 'Filter by associated Parent Donor',
      multiple: false,
      searchable: true,
      items: []
    },
    hideExpression: true
  };

  donorParentTypeField: FormlyFieldConfig = {
    key: 'donorParentType',
    type: 'multicheckbox',
    className: 'col-sm-4',
    templateOptions: {
      type: 'array',
      label: 'Parent Donor\'s Type?',
      options: [
        {label: 'Business', value: 'BUSINESS' },
        {label: 'Drop Point', value: 'DROPPOINT' }
      ],
      required: false,
    },
    hideExpression: true
  };

  filter: any = {};
  filterCount = 0;
  filterModel: any = {archived: [false]};
  filterOptions: FormlyFormOptions = {};
  filterForm: FormGroup = new FormGroup({});
  filterFields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'type',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [],
          templateOptions: {
            label: 'Type of device',
            type: 'array',
            options: [
              { label: 'Laptop', value: 'LAPTOP' },
              { label: 'Tablet', value: 'TABLET' },
              { label: 'Smart Phone', value: 'SMARTPHONE' },
              { label: 'All In One (PC)', value: 'ALLINONE' },
              { label: 'Desktop', value: 'DESKTOP' },
              { label: 'SIM Card', value: 'COMMSDEVICE' },
              { label: 'Other', value: 'OTHER' },
              { label: 'Broadband Hub', value: 'BROADBANDHUB' }
            ],
          }
        },
        {
          key: 'archived',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [false],
          templateOptions: {
            type: 'array',
            label: 'Filter by Archived?',
            options: [
              { label: 'Active Devices', value: false },
              { label: 'Archived Devices', value: true },
            ],
            required: false,
          }
        },
        {
          className: 'col-sm-4',
          fieldGroup: [
            {
              key: 'subStatus.lockedToUser',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Locked to user?',
                required: false,
              },
            },
            {
              key: 'subStatus.wipeFailed',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Device wipe failed?',
                required: false,
              },
            },
            {
              key: 'subStatus.installationOfOSFailed',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'OS Installation failed?',
                required: false,
              },
            },
            {
              key: 'subStatus.needsFurtherInvestigation',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Needs further investigation?',
                required: false,
              },
            },
            {
              key: 'subStatus.needsSparePart',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Needs spare part?',
                required: false,
              },
            }

          ]
        },
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Status of the device',
            items: KIT_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        this.deviceRequestField,
        this.donorParentField,
        this.donorParentTypeField
      ]
    },
    {
      validators: {
        validation: [{ name: 'dateRange', options: { errorPath: 'after' } }],
      },
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'after',
          type: 'date',
          className: 'col-md-6',
          templateOptions: {
            label: 'Devices created on or after?',
            required: false
          }
        },
        {
          key: 'before',
          type: 'date',
          className: 'col-md-6',
          templateOptions: {
            label: 'Devices created on or before?',
            required: false
          }
        },
      ]
    }
  ];



  donors$: Observable<any>;
  donorInput$ = new Subject<string>();
  donorLoading = false;
  donorField: FormlyFieldConfig = {
    key: 'donorId',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Donor',
      description: 'The donor this device is currently assigned to.',
      loading: this.donorLoading,
      typeahead: this.donorInput$,
      placeholder: 'Assign device to a Donor',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };

  quickForm: FormGroup = new FormGroup({});
  quickFields: Array<FormlyFieldConfig> = [
    {
      key: 'type',
      type: 'radio',
      className: '',
      defaultValue: 'LAPTOP',
      templateOptions: {
        label: 'Type of device',
        options: [
          {label: 'Laptop', value: 'LAPTOP' },
          {label: 'Tablet', value: 'TABLET' },
          {label: 'Smart Phone', value: 'SMARTPHONE' },
          {label: 'All In One (PC)', value: 'ALLINONE' },
          {label: 'Desktop', value: 'DESKTOP' },
          {label: 'SIM Card', value: 'COMMSDEVICE' },
          {label: 'Other', value: 'OTHER' },
          {label: 'Broadband Hub', value: 'BROADBANDHUB' }
        ],
        required: true
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'make',
          type: 'input',
          className: 'col-md-3',
          defaultValue: '',
          templateOptions: {
            label: 'Device Make',
            rows: 2,
            placeholder: '',
            required: false
          }
        },
        {
          key: 'model',
          type: 'input',
          className: 'col-md-9',
          defaultValue: '',
          templateOptions: {
            label: 'Device Model',
            rows: 2,
            placeholder: '',
            required: true
          }
        }
      ]
    },
    this.donorField
  ]

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'kit-index';

  applyFilter(data) {
    const filter = {AND: []};
    let count = 0;

    if (data.type && data.type.length) {
      count = count + data.type.length;
      filter['type'] = {'_in': data.type };
    }

    if (data.status && data.status.length) {
      count = count + data.status.length;
      filter['status'] = {'_in': data.status };
    }

    if(data.subStatus) {
      const subStatusItems = { };

      for (let key in data.subStatus) {
        if(data.subStatus[key]) {
          count++;
          subStatusItems[key] = { _in: data.subStatus[key] };
        }
      }

    filter['subStatus'] = subStatusItems;
  }

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    if (data.deviceRequestIds && data.deviceRequestIds.length) {
      count += data.deviceRequestIds.length;
      filter['deviceRequest'] = {id: {_in: data.deviceRequestIds}};
    }

    if (data.donorParentId && data.donorParentId.length) {
      count += 1;
      filter['donor'] = {donorParent: {id: {_eq: data.donorParentId}}};
    }

    if (data.donorParentType && data.donorParentType.length) {
      count += data.donorParentType.length;
      filter['donor'] = {donorParent: {type: {_in: data.donorParentType}}};
    }

    if(data.after){
      count += 1;
      filter['AND'].push({createdAt: {_gt: data.after }});
    }

    if(data.before){
      const endDate : Date = data.before;
      endDate.setDate(endDate.getDate() + 1);

      count += 1;
      filter['AND'].push({createdAt: {_lt: endDate }});
    }

    localStorage.setItem(`kitFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    this.table.ajax.reload(null, false);
  }

  resetFilterForm() {
    this.filterForm.reset();
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

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        this.isDonorParentAdmin = (user && user.authorities && user.authorities['read:donorParents']);
        //console.log(this.isDonorParentAdmin);
        this.donorParentField.hideExpression = !this.isDonorParentAdmin;
        this.donorParentTypeField.hideExpression = !this.isDonorParentAdmin;
      })
    );

    const deviceRequestRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DEVICE_REQUESTS,
      variables: {
      }
    });

    this.deviceRequests$ = concat(
      of([]),
      this.deviceRequestInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.deviceRequestLoading = true),
        switchMap(term => from(deviceRequestRef.refetch({
          term: term,
          ids: this.filterModel.deviceRequestIds || [],
        })).pipe(
          catchError(() => of([])),
          tap(() => this.deviceRequestLoading = false),
          switchMap(res => {
            const data = res['data']['deviceRequestConnection']['content'].map(v => {
              return {
                label: this.deviceRequestName(v), value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.deviceRequests$.subscribe(data => {
      this.deviceRequestField.templateOptions['items'] = data;
    }));

    const donorRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DONORS,
      variables: {
      }
    });

    this.donors$ = concat(
      of([]),
      this.donorInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.donorLoading = true),
        switchMap(term => from(donorRef.refetch({
          term: term
        })).pipe(
          catchError(() => of([])),
          tap(() => this.donorLoading = false),
          switchMap(res => {
            const data = res['data']['donorsConnection']['content'].map(v => {
              return {
                label: this.donorName(v), value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.donors$.subscribe(data => {
      this.donorField.templateOptions['items'] = data;
    }));

    const donorParentRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DONOR_PARENTS,
      variables: {
      }
    });

    this.donorParents$ = concat(
      of([]),
      this.donorParentInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.donorParentLoading = true),
        switchMap(term => from(donorParentRef.refetch({
          term: term,
          id: this.filterModel.donorParentId || null
        })).pipe(
          catchError(() => of([])),
          tap(() => this.donorParentLoading = false),
          switchMap(res => {
            const data = res['data']['donorParentsConnection']['content'].map(v => {
              return {
                label: `${this.donorParentName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.donorParents$.subscribe(data => {
      this.donorParentField.templateOptions['items'] = data;
    }));

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
          term: params['search']['value']
        };

        queryRef.refetch(vars).then(res => {
          let data: any = {};
          if (res.data) {
            data = res['data']['kitsConnection'];
            if (!this.total) {
              this.total = data['totalElements'];
            }
            data.content.forEach(d => {
              if (d.donor) {
                d.donorName = this.donorName(d.donor);
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
        { data: null, width: '15px', orderable: false  },
        { data: 'make' },
        { data: 'model' },
        { data: 'donor' },
        { data: 'createdAt'},
        { data: 'updatedAt'},
        { data: 'age'},
        { data: 'type' },
        { data: 'status' },
      ]
    };
  }

  deviceRequestName(data) {
    return `${data.referringOrganisationContact.referringOrganisation.name || ''}||${data.id || ''}||${data.referringOrganisationContact.email || ''}||${data.referringOrganisationContact.phoneNumber || ''}`
      .split('||')
      .filter((f) => f.trim().length)
      .join(' / ')
      .trim();
  }

  donorName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  donorParentName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
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
        this.filterModel = JSON.parse(localStorage.getItem(`kitFilters-${this.tableId}`)) || {archived: [false]};
        if (this.filterModel && (this.filterModel.deviceRequestIds || this.filterModel.donorParentId) ) {
          this.apollo
          .query({
            query: FIND_USERS,
            variables: {
              deviceRequestIds: this.filterModel.deviceRequestIds || [],
              donorParentId: this.filterModel.donorParentId || []
            }
          })
          .toPromise()
          .then(res => {
            if (res.data) {
              if (res.data['deviceRequests']) {
                this.deviceRequestField.templateOptions['items'] = res.data['deviceRequests'].map(v => {
                  return {label: this.deviceRequestName(v), value: v.id };
                });
              }
              if (res.data['donorParents']) {
                this.donorParentField.templateOptions['items'] = res.data['donorParents'].map(v => {
                  return {label: this.donorParentName(v), value: v.id };
                });
              }
            }
          });
        }
      } catch (_) {
        this.filterModel = {archived: [false]};
      }

      try {
        this.applyFilter(this.filterModel);
        this.filterForm.patchValue(this.filterModel);
      } catch (_) {
      }
    });
  }

  quickCreateEntity(data:any){

    this.apollo.mutate({
      mutation: CREATE_QUICK_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.total = null;
      this.table.ajax.reload(null, false);
       this.toastr.info(`
        <small>Successfully created device</small>
        `, '', {
            enableHtml: true
          });
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Device Error', {
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
