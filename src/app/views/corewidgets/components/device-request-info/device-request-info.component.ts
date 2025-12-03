import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription, concat, from } from 'rxjs';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { Title } from '@angular/platform-browser';

export const DEVICE_REQUEST_STATUS = {
    'NEW':'New request',
    'PROCESSING_EQUALITIES_DATA_COMPLETE':'Equalities data complete',
    'PROCESSING_COLLECTION_DELIVERY_ARRANGED':'Collection/Delivery arranged',
    'PROCESSING_ON_HOLD':'On hold',
    'REQUEST_COMPLETED':'Completed',
    'REQUEST_DECLINED':'Declined',
    'REQUEST_CANCELLED':'Cancelled',
}

export const DEVICE_REQUEST_STATUS_LABELS = [
  {label: 'New request', value: 'NEW'},
  {label: 'Equalities data complete', value: 'PROCESSING_EQUALITIES_DATA_COMPLETE'},
  {label: 'Collection/Delivery arranged', value: 'PROCESSING_COLLECTION_DELIVERY_ARRANGED'},
  {label: 'On hold', value: 'PROCESSING_ON_HOLD'},
  {label: 'Completed', value: 'REQUEST_COMPLETED'},
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

const UPDATE_ENTITY = gql`
  mutation updateDeviceRequest($data: UpdateDeviceRequestInput!) {
    updateDeviceRequest(data: $data) {
      id
      status
      createdAt
      updatedAt
      collectionDate
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
  styleUrls: ['./device-request-info.component.scss']
})
export class DeviceRequestInfoComponent {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo,
    private titleService: Title
  ) {
    titleService.setTitle("TaDa - Device Request");
    // Store component reference globally for access from template
    (window as any)['deviceRequestComponent'] = this;
    console.log('DeviceRequestComponent constructor - window.deviceRequestComponent set:', (window as any)['deviceRequestComponent']);
  }

  sub: Subscription;
  form: FormGroup = new FormGroup({});
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
    console.log('toggleDeviceTypes called! Current state:', this.showAllDeviceTypes);
    this.showAllDeviceTypes = !this.showAllDeviceTypes;
    console.log('New state:', this.showAllDeviceTypes);

    // Update button text and icon
    const icon = document.getElementById('toggleIcon');
    const text = document.getElementById('toggleText');

    console.log('Icon element:', icon);
    console.log('Text element:', text);

    if (icon && text) {
      if (this.showAllDeviceTypes) {
        icon.className = 'fas fa-chevron-up';
        text.textContent = 'Show only requested types';
      } else {
        icon.className = 'fas fa-chevron-down';
        text.textContent = 'Show all device types';
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
                    <div class="text-center my-2">
                      <button type="button" class="btn btn-sm btn-outline-secondary" id="toggleDeviceTypesBtn">
                        <i class="fas fa-chevron-down" id="toggleIcon"></i>
                        <span id="toggleText">Show all device types</span>
                      </button>
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
                  },
                  hooks: {
                    afterViewInit: () => {
                      console.log('afterViewInit hook called');
                      // Use native DOM manipulation to attach event
                      setTimeout(() => {
                        const btn = document.getElementById('toggleDeviceTypesBtn');
                        console.log('Button found:', btn);
                        if (btn) {
                          // Remove any existing handler first
                          const newBtn = btn.cloneNode(true) as HTMLElement;
                          btn.parentNode?.replaceChild(newBtn, btn);

                          // Add new handler
                          newBtn.addEventListener('click', (e) => {
                            console.log('Button clicked via addEventListener!');
                            e.preventDefault();
                            (window as any)['deviceRequestComponent']?.toggleDeviceTypes();
                          });
                          console.log('Event listener attached');
                        }
                      }, 100);
                    }
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
                type: 'date',
                label: 'Collection Date',
                description: 'Scheduled date for collection or delivery',
                required: false
              }
            },
            this.newNoteField,
            this.notesField,
            {
              key: 'isSales',
              type: 'checkbox',
              className: 'px-1',
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

    this.generatingPdf = true;

    try {
      // Prepare the data for the PDF template
      const pdfData = {
        // Header fields
        companyName: this.model.referringOrganisationContact?.referringOrganisation?.name || '',
        documentTitle: `Device Request #${this.requestId}`,
        date: new Date().toLocaleDateString(),

        // Device Request details
        requestId: this.requestId,
        status: DEVICE_REQUEST_STATUS[this.model.status as keyof typeof DEVICE_REQUEST_STATUS] || this.model.status,
        clientRef: this.model.clientRef || 'N/A',
        borough: this.model.borough || 'N/A',
        refereeName: this.model.referringOrganisationContact?.fullName || '',
        details: this.model.details || '',

        // Device counts
        laptops: this.model.deviceRequestItems?.laptops || 0,
        phones: this.model.deviceRequestItems?.phones || 0,
        tablets: this.model.deviceRequestItems?.tablets || 0,
        allInOnes: this.model.deviceRequestItems?.allInOnes || 0,
        desktops: this.model.deviceRequestItems?.desktops || 0,
        commsDevices: this.model.deviceRequestItems?.commsDevices || 0,
        broadbandHubs: this.model.deviceRequestItems?.broadbandHubs || 0,
        other: this.model.deviceRequestItems?.other || 0,

        // Additional info
        isSales: this.model.isSales ? 'Yes' : 'No',
        createdAt: new Date(this.model.createdAt).toLocaleDateString(),
        updatedAt: new Date(this.model.updatedAt).toLocaleDateString(),
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
