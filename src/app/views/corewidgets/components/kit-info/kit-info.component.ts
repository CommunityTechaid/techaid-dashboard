import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription, concat, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { isInteger } from '@ng-bootstrap/ng-bootstrap/util/util';
import { UpdateFormDirty } from '@ngxs/form-plugin';
import { Select } from '@ngxs/store';
import { Lightbox } from 'ngx-lightbox';
import { isObject } from 'util';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { HashUtils } from '@app/shared/utils';

export const KIT_STATUS = {
  'DONATION_NEW': 'New device registered',
  'DONATION_DECLINED': 'Device declined',
  'DONATION_ACCEPTED': 'Donor contacted',
  'DONATION_NO_RESPONSE': 'No response from donor',
  'DONATION_ARRANGED': 'Device drop off scheduled by donor',
  'PROCESSING_START': 'Device received into CTA',
  'PROCESSING_WIPED': 'Device wiped',
  'PROCESSING_FAILED_WIPE': 'Device wipe failed',
  'PROCESSING_OS_INSTALLED': 'OS installed',
  'PROCESSING_FAILED_INSTALLATION': 'OS installation failed',
  'PROCESSING_WITH_TECHIE': 'Device needs further investigation',
  'PROCESSING_MISSING_PART': 'Device needs spare part',
  'PROCESSING_STORED': 'Device stored',
  'ALLOCATION_READY': 'Assessment check completed - ready for allocation',
  'ALLOCATION_QC_COMPLETED': 'Quality check completed',
  'ALLOCATION_DELIVERY_ARRANGED': 'Collection/drop off to beneficiary arranged',
  'DISTRIBUTION_DELIVERED': 'Device received by beneficiary',
  'DISTRIBUTION_RECYCLED': 'Device recycled',
  'DISTRIBUTION_REPAIR_RETURN':'Device in for repair'
};

export const KIT_STATUS_LABELS = [
  {label: 'New device registered', value: 'DONATION_NEW'},
  {label: 'Device declined', value: 'DONATION_DECLINED'},
  {label: 'Donor contacted', value: 'DONATION_ACCEPTED'},
  {label: 'No response from donor', value: 'DONATION_NO_RESPONSE'},
  {label: 'Device drop off scheduled by donor', value: 'DONATION_ARRANGED'},
  {label: 'Device received into CTA', value: 'PROCESSING_START'},
  {label: 'Device wiped', value: 'PROCESSING_WIPED'},
  {label: 'Device wipe failed', value: 'PROCESSING_FAILED_WIPE'},
  {label: 'OS installed', value: 'PROCESSING_OS_INSTALLED'},
  {label: 'OS installation failed', value: 'PROCESSING_FAILED_INSTALLATION'},
  {label: 'Device needs further investigation', value: 'PROCESSING_WITH_TECHIE'},
  {label: 'Device needs spare part', value: 'PROCESSING_MISSING_PART'},
  {label: 'Device stored', value: 'PROCESSING_STORED'},
  {label: 'Assessment check completed - ready for allocation', value: 'ALLOCATION_READY'},
  {label: 'Quality check completed', value: 'ALLOCATION_QC_COMPLETED'},
  {label: 'Collection/drop off to beneficiary arranged', value: 'ALLOCATION_DELIVERY_ARRANGED'},
  {label: 'Device received by beneficiary', value: 'DISTRIBUTION_DELIVERED'},
  {label: 'Device recycled', value: 'DISTRIBUTION_RECYCLED'},
  {label: 'Device in for repair', value: 'DISTRIBUTION_REPAIR_RETURN'}
];

const QUERY_ENTITY = gql`
query findKit($id: Long) {
  kit(where: {
    id: {
      _eq: $id
    }
  }){
    id
    type
    status
    model
    location
    createdAt
    updatedAt
    age
    archived
    make
    deviceVersion
    serialNo
    storageCapacity
    typeOfStorage
    ramCapacity
    cpuType
    cpuCores
    tpmVersion
    volunteers {
      type
      volunteer {
        id
        name
        email
        phoneNumber
      }
    }
    donor {
      id
      name
      email
      phoneNumber
    }
    deviceRequest {
      id
      clientRef
      referringOrganisationContact {
        referringOrganisation {
          name
        }
      }
    }
    attributes {
      credentials
      status
      pickupAvailability
      notes
      network
      images {
        id
      }
      consent
      state
      pickup
      otherType
    }
    notes {
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
mutation updateKit($data: UpdateKitInput!) {
  updateKit(data: $data){
    id
    type
    status
    model
    location
    createdAt
    updatedAt
    age
    archived
    make
    deviceVersion
    serialNo
    storageCapacity
    typeOfStorage
    ramCapacity
    cpuType
    cpuCores
    tpmVersion
    volunteers {
      type
      volunteer {
        id
        name
        email
        phoneNumber
      }
    }
    donor {
      id
      name
      email
      phoneNumber
    }
    deviceRequest {
      id
      referringOrganisationContact {
        referringOrganisation {
          name
        }
      }
    }
    attributes {
      credentials
      pickupAvailability
      status
      notes
      network
      images {
        id
      }
      consent
      state
      pickup
      otherType
    }
    notes {
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
mutation deleteKit($id: ID!) {
  deleteKit(id: $id)
}
`;



const AUTOCOMPLETE_USERS = gql`
query findAutocompleteVolunteers($term: String, $subGroup: String) {
  volunteersConnection(page: {
    size: 50
  }, where: {
    name: {
      _contains: $term
    }
    subGroup: {
      _contains: $subGroup
    }
    OR: [
    {
      subGroup: {
        _contains: $subGroup
      }
      phoneNumber: {
        _contains: $term
      }
    },
    {
       subGroup: {
        _contains: $subGroup
      }
      email: {
        _contains: $term
      }
    }]
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

const AUTOCOMPLETE_DONORS = gql`
query findAutocompleteDonors($term: String) {
  donorsConnection(page: {
    size: 50
  }, where: {
    id: {
      _contains: $term
    }
  }){
    content  {
     id
    }
  }
}
`;

const AUTOCOMPLETE_DEVICE_REQUESTS = gql`
query findAutocompleteDeviceRequests($term: String) {
  deviceRequestConnection(page: {
    size: 50
  }, where: {
    id: {
      _contains: $term
    }
    OR: [
    { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } },
    { clientRef: { _contains: $term } }
    ]
  }){
    content  {
     id
     clientRef
     referringOrganisationContact {
      referringOrganisation {
        name
      }
     }
    }
  }
}
`;

@Component({
  selector: 'kit-info',
  styleUrls: ['kit-info.scss'],

  templateUrl: './kit-info.html'
})
export class KitInfoComponent {


  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo,
    private lightbox: Lightbox
  ) {

  }
  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {};
  model: any = {};
  deviceModel = {};
  entityName: string;
  entityId: number;
  album = [];

  organisers$: Observable<any>;
  organisersInput$ = new Subject<string>();
  organisersLoading = false;
  organisersField: FormlyFieldConfig = {
    key: 'organiserIds',
    type: 'choice',
    className: 'px-2 ml-auto justify-content-end text-right',
    templateOptions: {
      label: 'Organisation request',
      loading: this.organisersLoading,
      typeahead: this.organisersInput$,
      placeholder: 'Assign device to Organiser Volunteers',
      multiple: true,
      searchable: true,
      items: [],
      required: false,
    },
  };

  logistics$: Observable<any>;
  logisticsInput$ = new Subject<string>();
  logisticsLoading = false;
  logisticsField: FormlyFieldConfig = {
    key: 'logisticIds',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Logistics Volunteer',
      loading: this.logisticsLoading,
      typeahead: this.logisticsInput$,
      placeholder: 'Assign device to Logistic Volunteers',
      multiple: true,
      searchable: true,
      items: [],
      required: false
    },
  };

  technicians$: Observable<any>;
  techniciansInput$ = new Subject<string>();
  techniciansLoading = false;
  techniciansField: FormlyFieldConfig = {
    key: 'technicianIds',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Tech Volunteer',
      loading: this.techniciansLoading,
      typeahead: this.techniciansInput$,
      placeholder: 'Assign device to Tech Volunteers',
      multiple: true,
      searchable: true,
      items: [],
      required: false
    },
  };

  donors$: Observable<any>;
  donorInput$ = new Subject<string>();
  donorLoading = false;
  donorField: FormlyFieldConfig = {
    key: 'donorId',
    type: 'choice',
    className: 'px-2 ml-auto justify-content-end text-right',
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

  deviceRequests$: Observable<any>;
  deviceRequestInput$ = new Subject<string>();
  deviceRequestLoading = false;
  deviceRequestField: FormlyFieldConfig = {
    key: 'deviceRequestId',
    type: 'choice',
    className: 'px-2 ml-auto justify-content-end text-right',
    templateOptions: {
      label: 'Device Request',
      description: 'The device request this device is currently assigned to.',
      loading: this.deviceRequestLoading,
      typeahead: this.deviceRequestInput$,
      placeholder: 'Assign device to a Device Request',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };

  newNoteField: FormlyFieldConfig = {
    key: 'note.content',
    type: 'new-note',
    templateOptions: {
      placeholder: "Enter text and your initials. The current date and time will be automatically added to the note. Click the save button to save all your changes"
    }
  }

  notesField: FormlyFieldConfig = {
    type: 'notes',
    templateOptions: {
      notes: [],
    },
  }

  /*
    kit-info-input type is slightly complicated/unintuitive
    Check the custom-kit-info-input.ts file for the documentation on how to use and the underlying template.
   */
  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row border-top-info d-flex p-2 mb-2',
      fieldGroup: [
        {
          key: 'type',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
           label: "Device",
           type: "select",
            options: [
              {label: 'Laptop', value: 'LAPTOP' },
              {label: 'Chromebook', value: 'CHROMEBOOK' },
              {label: 'Tablet', value: 'TABLET' },
              {label: 'Smart Phone', value: 'SMARTPHONE' },
              {label: 'All In One (PC)', value: 'ALLINONE' },
              {label: 'Desktop', value: 'DESKTOP' },
              {label: 'Connectivity Device', value: 'COMMSDEVICE' },
              {label: 'Other', value: 'OTHER' }
            ]
          }
        },
        {
          key: 'ramCapacity',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "RAM",
            descriptor: "GB",
            type:"number"
          }
        },
        {
          key: 'typeOfStorage',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "Storage Type",
            type: "select",
            options: [
              {label: 'HDD', value: 'HDD' },
              {label: 'SSD', value: 'SSD' },
              {label: 'Hybrid', value: 'HYBRID' },
              {label: 'Unknown', value: 'UNKNOWN' }
            ]
          }
        },
        {
          key: 'storageCapacity',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "Capacity",
            type: "number",
            descriptor: "GB"
          }
        },
        this.donorField
      ]
    },
    {
      fieldGroupClassName: 'row border-bottom border-top d-flex p-2 mb-3',
      fieldGroup: [
        {
          key: 'serialNo',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "Serial Number"
          }
        },
        this.deviceRequestField
      ]
    },
    {
      fieldGroupClassName: 'row border-bottom-warning bordered p-2 mb-3',
      fieldGroup: [
        {
          key: 'status',
          type: 'radio',
          className: 'col-md-4 kit-status',
          defaultValue: 'DONATION_NEW',
          templateOptions: {
            label: 'Status of the device',
            options: KIT_STATUS_LABELS,
            required: true
          }
        },
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-5',
          fieldGroup: [
            /* {
              type: 'textarea',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Add new note about device',
                rows: 4,
                required: false,
                placeholder: 'Enter text and your initials. The current date and time will be automatically added to the comment'
              }
            }, */
            this.newNoteField,
            this.notesField,
            {
              key: 'archived',
              type: 'radio',
              className: '',
              templateOptions: {
                type: 'array',
                label: 'Archived?',
                description: 'Archived kits are hidden from view',
                options: [
                  {label: 'Device Active and Visible', value: false },
                  {label: 'Archive and Hide this Device', value: true },
                ],
                required: true,
              }
            },
            {
              template: `
              <div class="alert alert-warning shadow" role="alert">
                Please ensure the donor has been updated with the reasons why
                the donation has been <span class="badge badge-danger">DECLINED<span>
              </div>
              `,
              hideExpression: 'model.status != \'DECLINED\''
            },
          ]
        }
        /* ,{
          fieldGroupClassName: 'd-none flex-column justify-content-between',
          className: 'col-md-4',
          fieldGroup: [
            {
              key: 'location',
              type: 'place',
              className: 'col-md-12',
              defaultValue: '',
              templateOptions: {
                label: 'Location of device',
                placeholder: '',
                postCode: false,
                required: true
              }
            },
            this.techniciansField,
            this.organisersField,
            this.logisticsField,
          ]
        } */
      ]
    },
    {
      key: 'attributes.pickup',
      type: 'radio',
      className: 'col-md-12',
      defaultValue: 'DROPOFF',
      templateOptions: {
        label: 'Are you able to drop off your device to a location in Lambeth or would you need it to be collected?',
        placeholder: '',
        required: true,
        options: [
          { label: 'I am able to drop off my device to a location in Lambeth', value: 'DROPOFF' },
          { label: 'I would need you to come and collect my device', value: 'PICKUP' },
          { label: 'I\'m not sure – it depends on the exact location', value: 'NOTSURE' }
        ]
      }
    },
    {
      key: 'attributes.pickupAvailability',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Pickup Availability',
        rows: 2,
        description: `
          Please let us know when you are typically available at home for someone
          to arrange to come and pick up your device. Alternatively provide us with times
          when you are usually not available.
          `,
        required: true
      },
      hideExpression: 'model.attributes.pickup != \'PICKUP\'',
    },
    {
      template: `
      <div class="row">
        <div class="col-md-12">
          <div class="border-bottom-info card mb-3 p-3">
            <strong><p>About your device</p></strong>
            <p>
              In order to understand what condition your device is in - and how easy it will be for us
              to get it ready to deliver - please answer as many of the following questions as you can.
            </p>
          </div>
        </div>
      </div>
      `
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          className: 'col-md-6',
          fieldGroup: [
            {
              key: 'type',
              type: 'radio',
              className: '',
              defaultValue: 'LAPTOP',
              templateOptions: {
                label: 'Type of device',
                options: [
                  {label: 'Laptop', value: 'LAPTOP' },
                  {label: 'Chromebook', value: 'CHROMEBOOK' },
                  {label: 'Tablet', value: 'TABLET' },
                  {label: 'Smart Phone', value: 'SMARTPHONE' },
                  {label: 'All In One (PC)', value: 'ALLINONE' },
                  {label: 'Desktop', value: 'DESKTOP' },
                  {label: 'Connectivity Device', value: 'COMMSDEVICE' },
                  {label: 'Other', value: 'OTHER' }
                ],
                required: true
              }
            },
            {
              key: 'attributes.otherType',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Type of device',
                rows: 2,
                placeholder: '(Other device type)',
                required: true
              },
              hideExpression: 'model.type != \'OTHER\'',
              expressionProperties: {
                'templateOptions.required': 'model.type == \'OTHER\'',
              },
            },

            {
              key: 'attributes.network',
              type: 'radio',
              className: '',
              templateOptions: {
                label: 'Is the phone currently locked to a specific network provider?',
                description: '',
                options: [
                  {label: 'Phone is Unlocked', value: 'UNLOCKED' },
                  {label: 'I don\'t know', value: 'UNKNOWN' },
                  {label: 'Locked: EE', value: 'EE' },
                  {label: 'Locked: O2', value: 'O2' },
                  {label: 'Locked: Three', value: 'Three' },
                  {label: 'Locked: Vodafone', value: 'Vodafone' },
                  {label: 'Locked: GiffGaff', value: 'GiffGaff' },
                  {label: 'Locked: Sky Mobile', value: 'SkyMobile' },
                  {label: 'Locked: Tesco Mobile', value: 'TescoMobile' },
                  {label: 'Locked: BT Mobile', value: 'BTMobile' },
                  {label: 'Locked: Virgin Mobile', value: 'VirginMobile' },
                  {label: 'Locked: Talk Talk', value: 'TalkTalk' },
                  {label: 'Locked: Other', value: 'OTHER' }
                ],
                required: true
              },
              hideExpression: (model, state, field) => {
                const data = field.parent.formControl.value || {};
                return data['type'] != 'SMARTPHONE';
              },
            },
            {
              key: 'attributes.otherNetwork',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'The other network the device is locked to',
                rows: 2,
                placeholder: '(Other Network)',
                required: true
              },
              hideExpression: (model, state, field) => {
                const data = (field.parent.formControl.value || {}).attributes || {};
                return data['network'] != 'OTHER';
              },
              expressionProperties: {
                'templateOptions.required': (model, state, field) => {
                  const data = (field.parent.formControl.value || {}).attributes || {};
                  return data['network'] == 'OTHER';
                },
              },
            },
          ]
        },
        {
          className: 'col-md-6',
          fieldGroup: [
            {
              key: 'attributes.status',
              type: 'multicheckbox',
              className: '',
              templateOptions: {
                type: 'array',
                options: [],
                description: 'Please select all options that apply'
              },
              defaultValue: [],
              expressionProperties: {
                'templateOptions.options': (model, state, field) => {
                  const props = {
                    'LAPTOP': [
                      {label: 'I have the charger / power cable for the Laptop', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the Laptop', value: 'NO_CHARGER'},
                      {label: 'I have a password set for the Laptop', value: 'PASSWORD_PROTECTED'},
                      {label: 'I don\'t have a password set for the Laptop', value: 'NO_PASSWORD'}
                    ],
                    'CHROMEBOOK': [
                      {label: 'I have the charger / power cable for the Chromebook', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the Chromebook', value: 'NO_CHARGER'},
                      {label: 'I have a password set for the Chromebook', value: 'PASSWORD_PROTECTED'},
                      {label: 'I don\'t have a password set for the Chromebook', value: 'NO_PASSWORD'}
                    ],
                    'TABLET': [
                      {label: 'I have the charger for the Tablet', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the Tablet', value: 'NO_CHARGER'},
                      {label: 'Have you factory reset the Tablet?', value: 'FACTORY_RESET'}
                    ],
                    'SMARTPHONE': [
                      {label: 'I have the charger for the Phone', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the Phone', value: 'NO_CHARGER'},
                      {label: 'Have you factory reset the Phone?', value: 'FACTORY_RESET'}
                    ],
                    'ALLINONE': [
                      {label: 'I have the charger for the Computer', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the Computer', value: 'NO_CHARGER'},
                      {label: 'Do you have a mouse for the Computer?', value: 'HAS_MOUSE'},
                      {label: 'Do you have a keyboard for the Computer', value: 'HAS_KEYBOARD'},
                      {label: 'I have a password set for the Computer', value: 'PASSWORD_PROTECTED'},
                      {label: 'I don\'t have a password set for the Computer', value: 'NO_PASSWORD'}
                    ],
                    'DESKTOP': [
                      {label: 'I have the power cable for the Computer', value: 'CHARGER'},
                      {label: 'I don\'t have the power cable for the Computer', value: 'NO_CHARGER'},
                      {label: 'Do you have a mouse for the Computer?', value: 'HAS_MOUSE'},
                      {label: 'Do you have a keyboard for the Computer', value: 'HAS_KEYBOARD'},
                      {label: 'I have a password set for the Computer', value: 'PASSWORD_PROTECTED'},
                      {label: 'I don\'t have a password set for the Computer', value: 'NO_PASSWORD'}
                    ],
                    'OTHER': [
                      {label: 'I have the charger or power cable for the device', value: 'CHARGER'},
                      {label: 'I don\'t have the charger / power cable for the device', value: 'NO_CHARGER'},
                    ],
                    'COMMSDEVICE': [
                      {label: 'Mobile SIM card', value: 'MOBILE_SIM'},
                      {label: 'Data SIM card', value: 'DATA_SIM'},
                      {label: 'Dongle with SIM', value: 'DONGLE_SIM'},
                      {label: 'MiFi with SIM', value: 'MIFI_SIM'}
                    ],
                  };
                  let values = props[model['type']] || props['OTHER'];
                  const delta = {
                    'CHARGER': ['NO_CHARGER'],
                    'NO_CHARGER': ['CHARGER'],
                    'PASSWORD_PROTECTED': ['NO_PASSWORD'],
                    'NO_PASSWORD': ['PASSWORD_PROTECTED'],
                    'MOBILE_SIM': ['DATA_SIM', 'DONGLE_SIM', 'MIFI_SIM'],
                    'DATA_SIM': ['DONGLE_SIM', 'MIFI_SIM', 'MOBILE_SIM'],
                    'DONGLE_SIM': ['MIFI_SIM', 'MOBILE_SIM', 'DATA_SIM'],
                    'MIFI_SIM': ['MOBILE_SIM', 'DATA_SIM', 'DONGLE_SIM']
                  };
                  (field.formControl.value || []).forEach(val => {
                    if (delta[val]) {
                      values = values.filter(v => !delta[val].includes(v.value));
                    }
                  });
                  return values;
                },
              },
            },
            {
              key: 'attributes.credentials',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Device Password',
                description: 'If your device requires a password or a PIN to sign in, please provide it here',
                rows: 2,
                placeholder: 'Password',
                required: false
              },
              hideExpression: (model, state, field) => {
                const data = field.parent.formControl.value || {};
                const status = data.attributes.status || [];
                if (status && status.length) {
                  return status.indexOf('PASSWORD_PROTECTED') === -1;
                }
                return true;
              }
            },
          ]
        },
        {
          key: 'age',
          type: 'radio',
          className: 'col-md-6',
          templateOptions: {
            label: 'Roughly how old is your device?',
            options: [
              {label: 'Less than a year', value: 1},
              {label: '1 - 2 years', value: 2},
              {label: '3 - 4 years', value: 4 },
              {label: '5 - 6 years', value: 5},
              {label: 'More than 6 years old', value: 6 },
              {label: 'I don\'t know!', value: 0 }
            ],
            required: true
          }
        }
      ]
    },
    {
      key: 'model',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Make or model (if known)',
        rows: 2,
        placeholder: '',
        required: true
      }
    },
    {
      key: 'attributes.state',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'What technical state is the device in? For example, does it turn on OK? Are there keys missing? Is the screen cracked?',
        rows: 2,
        placeholder: '',
        required: false
      }
    },
    {
      template: `
      <div class="row">
        <div class="col-md-12">
          <div class="border-bottom-warning card mb-3 p-3">
            <p>
              In order to protect your data, Community TechAid will delete any personal information
              submitted via this form as soon as it has been used for collecting and delivering your device.
              Alternatively, if we don't collect your device, we will delete your information immediately.
              We promise to process your data in accordance with data protection legislation, and will not
              share your details with any third parties. You have the right to ask for your information to be
              deleted from our records - please contact contact@communitytechaid.org.uk for more information.
            </p>
          </div>
        </div>
      </div>
      `
    },
    {
      key: 'attributes.images',
      type: 'gallery',
      className: 'col-md-12',
      templateOptions: {
        label: 'Upload an image of your device if you can',
        prefix: '',
        required: false
      }
    },
    {
      key: 'attributes.consent',
      type: 'radio',
      className: 'col-md-12',
      templateOptions: {
        label: '',
        options: [
          {label: 'I consent to my data being processed by Community TechAid', value: 'yes' },
          {label: 'I do not consent to my data being processed by Community TechAid', value: 'no' },
        ],
        required: true
      }
    }
  ];

  private queryRef = this.apollo
    .watchQuery({
      query: QUERY_ENTITY,
      variables: {}
    });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {
    this.album = (data.attributes.images || []).map(function(src) {
      src.url = `https://api.communitytechaid.org.uk/kits/${data.id}/images/${src.id}`;
      return {src: src.url, thumb: src.url, caption: data.model};
    });
    if (data.volunteers) {
      const volunteers = {};
      data.volunteers.forEach(v => {
        volunteers[v.type] = volunteers[v.type] || [];
        volunteers[v.type].push({label: this.volunteerName(v.volunteer), value: v.volunteer.id});
      });

      data.organiserIds = (volunteers['ORGANISER'] || []).map(v => v.value);
      data.technicianIds = (volunteers['TECHNICIAN'] || []).map(v => v.value);
      data.logisticIds = (volunteers['LOGISTICS'] || []).map(v => v.value);

      this.organisersField.templateOptions['items'] = volunteers['ORGANISER'];
      this.techniciansField.templateOptions['items'] = volunteers['TECHNICIAN'];
      this.logisticsField.templateOptions['items'] = volunteers['LOGISTICS'];
    }
    if (data.donor && data.donor.id) {
      data.donorId = data.donor.id;
      this.donorField.templateOptions['items'] = [
        {label: data.donorId, value: data.donor.id}
      ];
    }

    if (data.deviceRequest && data.deviceRequest.id) {
      data.deviceRequestId = data.deviceRequest.id;
      this.deviceRequestField.templateOptions['items'] = [
        {label: this.organisationName(data.deviceRequest), value: data.deviceRequest.id}
      ];
    }

    this.newNoteField.templateOptions['kitId'] = this.entityId

    this.displayNotes(data)

    return data;
  }

  private displayNotes(data) {
    if (data.notes) {
      var notes = []
      data.notes.forEach(n => {
        notes.push({ content: n.content, id: n.id, volunteer: n.volunteer, updated_at: n.updatedAt });

      });
      this.notesField.templateOptions['notes'] = notes;
    }
  }

  open(index: number): void {
    this.lightbox.open(this.album, index, {
      alwaysShowNavOnTouchDevices: true,
      centerVertically: true
    });
  }

  private fetchData() {
    if (!this.entityId) {
      return;
    }

    this.queryRef.refetch({
      id: this.entityId
    }).then(res => {
      if (res.data && res.data['kit']) {
        const data = res.data['kit'];
        this.model = this.normalizeData(data);
        this.entityName = this.model['model'];
      } else {
        this.model = {};
        this.entityName = 'Not Found!';
        this.toastr.error(`
        <small>Unable to find a device with the id: ${this.entityId}</small>
        `, 'GraphQL Error', {
          enableHtml: true,
          timeOut: 15000,
          disableTimeOut: true
        });
      }
    }, err => {
      this.toastr.warning(`
          <small>${err.message}</small>
        `, 'GraphQL Error', {
        enableHtml: true,
        timeOut: 15000,
        disableTimeOut: true
      });
    });
  }


  ngOnInit() {
    const userRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_USERS,
        variables: {
        }
      });
    const donorRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_DONORS,
        variables: {
        }
      });

    const deviceRequestRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_DEVICE_REQUESTS,
        variables: {
        }
      });

    this.organisers$ = concat(
      of([]),
      this.organisersInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.organisersLoading = true),
        switchMap(term => from(userRef.refetch({
          term: term,
          subGroup: 'Organizing'
        })).pipe(
          catchError(() => of([])),
          tap(() => this.organisersLoading = false),
          switchMap(res => {
            const data = res['data']['volunteersConnection']['content'].map(v => {
              return {
                label: `${this.volunteerName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.logistics$ = concat(
      of([]),
      this.logisticsInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.logisticsLoading = true),
        switchMap(term => from(userRef.refetch({
          term: term,
          subGroup: 'Transport'
        })).pipe(
          catchError(() => of([])),
          tap(() => this.logisticsLoading = false),
          switchMap(res => {
            const data = res['data']['volunteersConnection']['content'].map(v => {
              return {
                label: `${this.volunteerName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.technicians$ = concat(
      of([]),
      this.techniciansInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.techniciansLoading = true),
        switchMap(term => from(userRef.refetch({
          term: term,
          subGroup: 'Technical'
        })).pipe(
          catchError(() => of([])),
          tap(() => this.techniciansLoading = false),
          switchMap(res => {
            const data = res['data']['volunteersConnection']['content'].map(v => {
              return {
                label: `${this.volunteerName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

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
                label: v.id, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.deviceRequests$ = concat(
      of([]),
      this.deviceRequestInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.deviceRequestLoading = true),
        switchMap(term => from(deviceRequestRef.refetch({
          term: term
        })).pipe(
          catchError(() => of([])),
          tap(() => this.deviceRequestLoading = false),
          switchMap(res => {
            const data = res['data']['deviceRequestConnection']['content'].map(v => {
              return {
                label: `${this.organisationName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub = this.activatedRoute.params.subscribe(params => {
      this.entityId = +params['kitId'];
      this.fetchData();
    });

    this.sub.add(this.organisers$.subscribe(data => {
      this.organisersField.templateOptions['items'] = data;
    }));

    this.sub.add(this.logistics$.subscribe(data => {
      this.logisticsField.templateOptions['items'] = data;
    }));

    this.sub.add(this.technicians$.subscribe(data => {
      this.techniciansField.templateOptions['items'] = data;
    }));

    this.sub.add(this.donors$.subscribe(data => {
      this.donorField.templateOptions['items'] = data;
    }));

    this.sub.add(this.deviceRequests$.subscribe(data => {
      this.deviceRequestField.templateOptions['items'] = data;
    }));
  }

  volunteerName(data) {
    return `${data.name || ''}||${data.email || ''}||${data.phoneNumber || ''}`.split('||').filter(f => f.trim().length).join(' / ').trim();
  }

  organisationName(data) {
    console.log(data)
    return `${data.referringOrganisationContact.referringOrganisation.name || ''}||${data.id || ''}`
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
    data.id = this.entityId;
    data.attributes.images = (data.attributes.images || []).map(f => {
      return {
        image: f.image,
        id: f.id
      };
    });
    // we set the value of content to a blank string if it is null so as to not create issues in the back
    // it will be checked to see if it is blank in the backend anyway so that blank notes are not created
    if (data.note.content == null){
      data.note.content = ""
    }
    this.apollo.mutate({
      mutation: UPDATE_ENTITY,
      variables: {
        data
      }
    }).subscribe(res => {
      this.model = this.normalizeData(res.data['updateKit']);
      this.entityName = this.model['model'];
      this.toastr.info(`
      <small>Successfully updated device ${this.entityName}</small>
      `, 'Updated Device', {
        enableHtml: true
      });
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Update Error', {
        enableHtml: true
      });
    });
  }

  deleteEntity() {
    this.apollo.mutate<any>({
      mutation: DELETE_ENTITY,
      variables: { id: this.entityId }
    }).subscribe(res => {
      if (res.data.deleteKit) {
        this.toastr.info(`
        <small>Successfully deleted device ${this.entityName}</small>
        `, 'Device Deleted', {
          enableHtml: true
        });
        this.router.navigate(['/dashboard/devices']);
      }
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Deleting Device', {
        enableHtml: true
      });
    });
  }
}
