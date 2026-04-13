import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription, concat, from } from 'rxjs';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { Title } from '@angular/platform-browser';
import { getKitTypeLabel } from '@app/shared/utils';

export const DEVICE_REQUEST_STATUS = {
    'NEW':'New request',
    'PROCESSING_EQUALITIES_DATA_COMPLETE':'Equalities data complete',
    'PROCESSING_COLLECTION_DELIVERY_ARRANGED':'Collection/Delivery arranged',
    'PROCESSING_ON_HOLD':'On hold',
    'REQUEST_COMPLETED':'Completed',
    'REQUEST_COLLECTION_DELIVERY_FAILED':'Collection/Delivery Failed',
    'REQUEST_DECLINED':'Declined',
    'REQUEST_CANCELLED':'Cancelled',
}

export const DEVICE_REQUEST_STATUS_LABELS = [
  {label: 'New request', value: 'NEW'},
  {label: 'Equalities data complete', value: 'PROCESSING_EQUALITIES_DATA_COMPLETE'},
  {label: 'Collection/Delivery arranged', value: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED'},
  {label: 'On hold', value: 'PROCESSING_ON_HOLD'},
  {label: 'Completed', value: 'REQUEST_COMPLETED'},
  {label: 'Collection/Delivery Failed', value: 'REQUEST_COLLECTION_DELIVERY_FAILED'},
  {label: 'Declined', value: 'REQUEST_DECLINED'},
  {label: 'Cancelled', value: 'REQUEST_CANCELLED'}
];

const QUERY_ENTITY = gql`
  query findDeviceRequest($id: Long) {
    deviceRequest(where: { id: { _eq: $id } }) {
      id
      status
      createdAt
      updatedAt
      collectionDate
      collectionMethod
      collectionContactName
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
      referringOrganisationContact {
        id
        fullName
        referringOrganisation {
          id
          name
        }
      }
      isSales
      isPrepped
      clientRef
      details
      borough
      kits {
        id
        type
        make
        model
      }
      deviceRequestNeeds {
        hasInternet
        hasMobilityIssues
        needQuickStart
      }
      deviceRequestNotes {
        id
        content
        volunteer
        createdAt
        updatedAt
      }
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateDeviceRequest($data: UpdateDeviceRequestInput!) {
    updateDeviceRequest(data: $data) {
      id
      status
      createdAt
      updatedAt
      collectionDate
      collectionMethod
      collectionContactName
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
      isSales
      isPrepped
      referringOrganisationContact {
        id
        fullName
        referringOrganisation {
          id
          name
        }
      }
      clientRef
      details
      borough
      deviceRequestNeeds {
        hasInternet
        hasMobilityIssues
        needQuickStart
      }
      deviceRequestNotes {
        id
        content
        volunteer
        createdAt
        updatedAt
      }
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteDeviceRequest($id: ID!) {
    deleteDeviceRequest(id: $id)
  }
`;

const QUERY_DEVICE_COUNT = gql`
  query countDevicesForRequest($deviceRequestId: Long) {
    kitsConnection(where: { deviceRequest: { id: { _eq: $deviceRequestId } } }) {
      totalElements
    }
  }
`;

const AUTOCOMPLETE_REFERRING_ORGANISATION_CONTACTS = gql`
query findAutocompleteReferringOrganisationContacts($term: String, $referringOrganisationId: Long) {
  referringOrganisationContactsConnection(page: {
    size: 50
  }, where: {
   AND: {
    fullName: { _contains: $term },
    referringOrganisation: { id: { _eq: $referringOrganisationId } },
    archived: { _eq:false }
   }
  }){
    content  {
      id
      fullName
      archived
      referringOrganisation {
          id
          name
        }
    }
  }
}
`;

@Component({
    selector: 'app-device-request-info',
    templateUrl: './device-request-info.component.html',
    styleUrls: ['./device-request-info.component.scss'],
    standalone: false
})
export class DeviceRequestInfoComponent {
  @ViewChild('kitWarning') kitWarningModal: any;

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo,
    private titleService: Title
  ) {
    titleService.setTitle("TaDa - Device Request");
  }

  sub: Subscription;
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  requestId: number;
  referringOrganisationId: number;
  referringOrganisationContactId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;
  showAllDeviceTypes = false;
  deviceCount: number = 0;

  deviceTypes = [
    { key: 'deviceRequestItems.laptops', label: 'Laptops', icon: 'fas fa-laptop' },
    { key: 'deviceRequestItems.phones', label: 'Phones', icon: 'fas fa-mobile-alt' },
    { key: 'deviceRequestItems.tablets', label: 'Tablets', icon: 'fas fa-tablet-alt' },
    { key: 'deviceRequestItems.allInOnes', label: 'All In Ones', icon: 'fas fa-desktop' },
    { key: 'deviceRequestItems.desktops', label: 'Desktops', icon: 'fas fa-desktop' },
    { key: 'deviceRequestItems.commsDevices', label: 'SIM Cards', icon: 'fas fa-microchip' },
    { key: 'deviceRequestItems.broadbandHubs', label: 'Broadband Hubs', icon: 'fas fa-wifi' },
    { key: 'deviceRequestItems.other', label: 'Other', icon: 'fas fa-laptop' }
  ];


  toggleDeviceTypes() {
    this.showAllDeviceTypes = !this.showAllDeviceTypes;

    // Update button icon (text stays the same)
    const icon = document.getElementById('toggleIcon');

    if (icon) {
      if (this.showAllDeviceTypes) {
        icon.className = 'fas fa-chevron-up';
      } else {
        icon.className = 'fas fa-chevron-down';
      }
    }

    // Trigger change detection by updating the form options
    this.options = { ...this.options };
  }

  newNoteField: FormlyFieldConfig = {
    key: 'deviceRequestNote.content',
    type: 'device-request-new-note',
    templateOptions: {
      placeholder: "Type your note here and hit save"
    }
  }

  notesField: FormlyFieldConfig = {
    type: 'device-request-notes',
    templateOptions: {
      notes: [],
    },
  }

  referringOrganisationContacts$: Observable<any>;
  referringOrganisationContactInput$ = new Subject<string>();
  referringOrganisationContactLoading = false;
  referringOrganisationContactField: FormlyFieldConfig = {
    key: 'referringOrganisationContactId',
    type: 'choice',
    className: 'text-left',
    templateOptions: {
      label: 'Referee',
      description: 'The referee this request is currently assigned to.',
      loading: this.referringOrganisationContactLoading,
      typeahead: this.referringOrganisationContactInput$,
      placeholder: 'Assign request to a Referee',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };

  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          // column 1
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-4',
          fieldGroup: [
            {
              key: 'status',
              type: 'radio',
              className: 'device-request-status',
              defaultValue: 'NEW',
              templateOptions: {
                label: 'Status of the request',
                options: DEVICE_REQUEST_STATUS_LABELS,
                required: true
              }
            },
            {
              key: 'isPrepped',
              type: 'checkbox',
              className: 'px-1 mt-4',
              hideExpression: (model: any) => {
                return model.status === 'NEW' || model.status === 'PROCESSING_EQUALITIES_DATA_COMPLETE';
              },
              templateOptions: {
                label: 'Is request fully prepped?',
                placeholder: '',
                required: false,
                description: 'Optional flag to track if request is fully prepped'
              }
            },
            {
              key: 'clientRef',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Organisation\'s client reference',
                // TODO: should this be required
                description: 'An organisation\'s internal reference for their client',
                required: false
              }
            },
            {
              key: 'borough',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Borough',
                description: 'Borough associated with the request',
                readonly: true
              }
            },
            // {
            //   key: 'deviceRequestNeeds.hasInternet',
            //   type: 'checkbox',
            //   className: '',
            //   templateOptions: {
            //     label: 'Has home internet',
            //     placeholder: '',
            //     required: false
            //   }
            // },
            // {
            //   key: 'deviceRequestNeeds.hasMobilityIssues',
            //   type: 'checkbox',
            //   className: '',
            //   templateOptions: {
            //     label: 'Mobility issues',
            //     placeholder: '',
            //     required: false
            //   }
            // },
            // {
            //   key: 'deviceRequestNeeds.needQuickStart',
            //   type: 'checkbox',
            //   className: '',
            //   templateOptions: {
            //     label: 'Training needs',
            //     placeholder: '',
            //     required: false
            //   }
            // },
          ]
        },
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-4',
          // column 2
          fieldGroup: [
            {
              key: 'details',
              type: 'textarea',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Referring organisation\'s details about the client',
                description: '',
                rows: 4,
                required: false
              }
            },
            {
              fieldGroup: [
                {
                  key: 'deviceRequestItems.laptops',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.laptops === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.laptops > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.phones',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.phones === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.phones > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.tablets',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.tablets === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.tablets > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.allInOnes',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.allInOnes === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.allInOnes > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.desktops',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.desktops === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.desktops > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.commsDevices',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.commsDevices === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.commsDevices > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                  key: 'deviceRequestItems.broadbandHubs',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.broadbandHubs === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.broadbandHubs > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
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
                },
                {
                  key: 'deviceRequestItems.other',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
                  hideExpression: (model: any) => {
                    return !this.showAllDeviceTypes && (!model.deviceRequestItems || model.deviceRequestItems.other === 0);
                  },
                  expressionProperties: {
                    'className': (model: any) => {
                      if (model.deviceRequestItems && model.deviceRequestItems.other > 0) {
                        return 'order-1';
                      }
                      return 'order-10';
                    }
                  },
                  templateOptions: {
                    min: 0,
                    label: 'Other',
                    addonLeft: {
                      class: 'fas fa-laptop'
                    },
                    type: 'number',
                    placeholder: '',
                    required: true
                  }
                },
                {
                  template: `
                    <div class="text-center my-2 btn btn-sm btn-outline-secondary" id="toggleDeviceTypesBtn" style="cursor: pointer;">
                      <i class="fas fa-chevron-down" id="toggleIcon"></i>
                      <span id="toggleText">Show/hide unused device types</span>
                    </div>
                  `,
                  hideExpression: (model: any) => {
                    // Hide button if all device types have values
                    if (!model.deviceRequestItems) return true;
                    const items = model.deviceRequestItems;
                    return items.laptops > 0 && items.phones > 0 && items.tablets > 0 &&
                           items.allInOnes > 0 && items.desktops > 0 && items.commsDevices > 0 &&
                           items.broadbandHubs > 0 && items.other > 0;
                  },
                  expressionProperties: {
                    'className': () => 'order-99'
                  }
                }
              ]
            }
          ]
        },
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-4',
          //column 3
          fieldGroup: [
            // {
            //   key: 'deviceRequestNotes',
            //   type: 'textarea',
            //   className: '',
            //   defaultValue: '',
            //   templateOptions: {
            //     label: 'Request fulfilment notes',
            //     rows: 4,
            //     required: false
            //   }
            // },
            this.referringOrganisationContactField,
            {
              key: 'collectionDate',
              type: 'input',
              className: '',
              templateOptions: {
                type: 'datetime-local',
                label: 'Collection/Delivery Date & Time',
                description: 'Scheduled date and time for collection or delivery',
                required: false
              }
            },
            {
              key: 'collectionMethod',
              type: 'radio',
              className: '',
              templateOptions: {
                label: 'Collection Arranged?',
                description: 'Select the method of collection or delivery',
                options: [
                  { label: 'Collection', value: 'COLLECTION' },
                  { label: 'Delivery', value: 'DELIVERY' }
                ],
                required: false
              }
            },
            {
              key: 'collectionContactName',
              type: 'input',
              className: '',
              templateOptions: {
                label: 'Contact Name',
                description: 'Name of the person who will collect the device',
                required: false
              }
            },
            this.newNoteField,
            this.notesField,
            {
              key: 'isSales',
              type: 'checkbox',
              className: 'px-1 mt-4',
              templateOptions: {
                label: 'Is this a commercial sale?',
                placeholder: '',
                required: false,
                description: 'Optional flag to track commercial sales'
              }
            }
          ]
        }
      ]
    }
  ];

  private queryRef = this.apollo.watchQuery({
    query: QUERY_ENTITY,
    variables: {},
  });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {

    this.newNoteField.templateOptions['requestId'] = this.requestId

    this.displayNotes(data)

    if (data.referringOrganisationContact && data.referringOrganisationContact.id) {
      data.referringOrganisationContactId = data.referringOrganisationContact.id;
      this.referringOrganisationContactField.templateOptions['items'] = [
        {label: this.referringOrganisationContactName(data.referringOrganisationContact), value: data.referringOrganisationContact.id}
      ];
      this.referringOrganisationContactField.templateOptions['label'] = data.referringOrganisationContact.referringOrganisation.name + ' Referee';
    }

    // Convert collectionDate from ISO 8601 UTC to datetime-local format
    if (data.collectionDate) {
      // Remove the 'Z' and convert to local datetime format (YYYY-MM-DDTHH:mm)
      const date = new Date(data.collectionDate);
      // Format as YYYY-MM-DDTHH:mm for datetime-local input
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      data.collectionDate = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    return data;
  }

  private displayNotes(data) {
    if (data.deviceRequestNotes) {

      var notes = []
      data.deviceRequestNotes.forEach(n => {
        notes.push({ content: n.content, id: n.id, volunteer: n.volunteer, updated_at: n.updatedAt });

      });
      this.notesField.templateOptions['notes'] = notes;
    }
  }

  private fetchData() {
    if (!this.requestId) {
      return;
    }

    this.queryRef
      .refetch({
        id: this.requestId,
      })
      .then(
        (res) => {
          if (res.data && res.data['deviceRequest']) {
            const data = res.data['deviceRequest'];
            this.model = this.normalizeData(data);
            this.requestId = this.model['id'];
            this.referringOrganisationId = this.model['referringOrganisationContact']['referringOrganisation']['id'];
            this.referringOrganisationContactId = this.model['referringOrganisationContact']['id'];
            this.fetchDeviceCount();
          } else {
            this.model = {};
            this.requestId = -1;
          }
        },
        (err) => {
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
  }

  private fetchDeviceCount() {
    if (!this.requestId) {
      return;
    }

    this.apollo
      .query({
        query: QUERY_DEVICE_COUNT,
        variables: {
          deviceRequestId: this.requestId,
        },
      })
      .subscribe(
        (res) => {
          if (res.data && res.data['kitsConnection']) {
            this.deviceCount = res.data['kitsConnection']['totalElements'];
          }
        },
        (err) => {
          console.error('Error fetching device count:', err);
        }
      );
  }

  ngOnInit() {
    const referringOrganisationContactRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_REFERRING_ORGANISATION_CONTACTS,
        variables: {
        }
      });

    this.referringOrganisationContacts$ = concat(
      of([]),
      this.referringOrganisationContactInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.referringOrganisationContactLoading = true),
        switchMap(term => from(referringOrganisationContactRef.refetch({
          term: term, referringOrganisationId: this.referringOrganisationId
        })).pipe(
          catchError(() => of([])),
          tap(() => this.referringOrganisationContactLoading = false),
          switchMap(res => {
            const data = res['data']['referringOrganisationContactsConnection']['content'].map(v => {
              return {
                label: `${this.referringOrganisationContactName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub = this.activatedRoute.params.subscribe((params) => {
      this.requestId = +params['requestId'];
      this.titleService.setTitle(`TaDa - Device Request ${this.requestId}`);
      this.fetchData();
    });

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:organisations']);
      })
    );

    this.sub.add(this.referringOrganisationContacts$.subscribe(data => {
      this.referringOrganisationContactField.templateOptions['items'] = data;
    }));

    // Set up global click handler for toggle button using event delegation
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if clicked element's text matches our toggle button text
      const text = target.textContent?.trim();
      if (text === 'Show/hide unused device types') {
        e.preventDefault();
        this.toggleDeviceTypes();
        return;
      }

      // Check if clicked element is the icon (has fa-chevron class)
      if (target.className && (target.className.includes('fa-chevron-down') || target.className.includes('fa-chevron-up'))) {
        e.preventDefault();
        this.toggleDeviceTypes();
        return;
      }

      // Check if clicked element is the icon or text span by ID
      if (target.id === 'toggleIcon' || target.id === 'toggleText' || target.id === 'toggleDeviceTypesBtn') {
        e.preventDefault();
        this.toggleDeviceTypes();
        return;
      }

      // Also check if clicked element or its parent is the toggle button
      const button = target.closest('#toggleDeviceTypesBtn');
      if (button) {
        e.preventDefault();
        this.toggleDeviceTypes();
      }
    });
  }


  referringOrganisationContactName(data) {
    return `${data.fullName || ''}||${data.id || ''}`
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

  updateEntity(data: any) {

    if (!this.form.valid) {
      this.model['showErrorState'] = true;
      return;
    }
    data.id = this.requestId;

    if (data.deviceRequestNote.content == null){
      data.deviceRequestNote.content = ""
    }
    this.apollo
      .mutate({
        mutation: UPDATE_ENTITY,
        variables: {
          data,
        },
      })
      .subscribe(
        (res) => {
          this.model = this.normalizeData(res.data['updateDeviceRequest']);
          this.requestId = this.model['id'];

          // Trigger form field update to reflect new visibility state
          this.options = { ...this.options };

          this.toastr.info(
            `
      <small>Successfully updated device request ${this.requestId}</small>
      `,
            'Updated Device Request',
            {
              enableHtml: true,
            }
          );
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Update Error',
            {
              enableHtml: true,
            }
          );
        }
      );
  }

  deleteEntity() {
    this.apollo
      .mutate<any>({
        mutation: DELETE_ENTITY,
        variables: { id: this.requestId },
      })
      .subscribe(
        (res) => {
          if (res.data.deleteDeviceRequest) {
            this.toastr.info(
              `
        <small>Successfully deleted device request ${this.requestId}</small>
        `,
              'Device Request Deleted',
              {
                enableHtml: true,
              }
            );
            this.router.navigate(['/dashboard/device-requests']);
          }
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Error Deleting Device Request',
            {
              enableHtml: true,
            }
          );
        }
      );
  }

  generatingPdf = false;

  async generatePDF() {
    if (!this.model || !this.model.id) {
      this.toastr.warning('Device request data not loaded', 'PDF Generation');
      return;
    }

    if (this.model.kits?.length >= 3) {
      this.modalService.open(this.kitWarningModal, { centered: true });
      return;
    }

    this.generatingPdf = true;

    try {
      // Prepare the data for the PDF template
      const pdfData = {
        // Header fields
        organisationName: this.model.referringOrganisationContact?.referringOrganisation?.name || 'N/A',
        date: this.model.collectionDate ? new Date(this.model.collectionDate).toLocaleDateString() : 'N/A',

        // Device Request details
        requestId: this.requestId,
        clientRef: this.model.clientRef || 'N/A',
        collectionContactName: this.model.collectionContactName || (this.model.referringOrganisationContact?.fullName ? `Referee: ${this.model.referringOrganisationContact.fullName}` : 'N/A'),
        
        // Device details
        dev1ID: this.model.kits[0]?.id || '',
        dev1Type: getKitTypeLabel(this.model.kits[0]?.type) || '',
        dev1Description: [this.model.kits[0]?.make, this.model.kits[0]?.model].filter(Boolean).join('/'),
        dev2ID: this.model.kits[1]?.id || '',
        dev2Type: getKitTypeLabel(this.model.kits[1]?.type) || '',
        dev2Description: [this.model.kits[1]?.make, this.model.kits[1]?.model].filter(Boolean).join('/'),
      
        isCollection: this.model.collectionMethod === 'COLLECTION' ? 'X' : '',
        isDelivery: this.model.collectionMethod === 'DELIVERY' ? 'X' : '',
      };

      // TODO: Replace with your actual Google Apps Script URL
      const appsScriptUrl = 'https://script.google.com/macros/s/AKfycbwvsi92ddWWf_LDn6rJdY3b9eTU0UfqIWwZsSpUCy8xrtdW1R6HsKwFECqbMMZRH-J1/exec';

      const response = await fetch(appsScriptUrl, {
        redirect: 'follow',
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(pdfData)
      });

      const result = await response.json();

      if (result.success) {
        // Open PDF in new tab
        window.open(result.pdfUrl, '_blank');

        this.toastr.success(
          `<small>PDF generated successfully</small>`,
          'PDF Generation',
          {
            enableHtml: true,
          }
        );
      } else {
        throw new Error(result.error || 'Failed to generate PDF');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate PDF';
      this.toastr.error(
        `<small>${errorMessage}</small>`,
        'PDF Generation Error',
        {
          enableHtml: true,
        }
      );
    } finally {
      this.generatingPdf = false;
    }
  }
}
