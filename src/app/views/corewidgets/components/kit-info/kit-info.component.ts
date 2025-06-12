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
import { UpdateFormDirty } from '@ngxs/form-plugin';
import { Select } from '@ngxs/store';
import { Lightbox } from 'ngx-lightbox';
import { isObject } from 'util';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { HashUtils } from '@app/shared/utils';
import { Title } from '@angular/platform-browser';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

export const KIT_STATUS = {
  'DONATION_NEW': 'New device registered',
  'PROCESSING_START': 'Device received into CTA',
  'PROCESSING_WIPED': 'Device wiped',
  'PROCESSING_OS_INSTALLED': 'OS installed',
  'ALLOCATION_READY': 'Assessment check completed',
  'ALLOCATION_QC_COMPLETED': 'Quality check completed',
  'ALLOCATION_DELIVERY_ARRANGED': 'Collection/drop off to beneficiary arranged',
  'DISTRIBUTION_DELIVERED': 'Device received by beneficiary',
  'DISTRIBUTION_RECYCLED': 'Device recycled',
  'DISTRIBUTION_REPAIR_RETURN':'Device in for repair',
  'PROCESSING_STORED': 'Device stored'
};

export const KIT_STATUS_LABELS = [
  {label: 'New device registered', value: 'DONATION_NEW'},
  {label: 'Device received into CTA', value: 'PROCESSING_START'},
  {label: 'Device wiped', value: 'PROCESSING_WIPED'},
  {label: 'OS installed', value: 'PROCESSING_OS_INSTALLED'},
  {label: 'Assessment check completed', value: 'ALLOCATION_READY'},
  {label: 'Quality check completed', value: 'ALLOCATION_QC_COMPLETED'},
  {label: 'Collection/drop off to beneficiary arranged', value: 'ALLOCATION_DELIVERY_ARRANGED'},
  {label: 'Device received by beneficiary', value: 'DISTRIBUTION_DELIVERED'},
  {label: 'Device recycled', value: 'DISTRIBUTION_RECYCLED'},
  {label: 'Device in for repair', value: 'DISTRIBUTION_REPAIR_RETURN'},
  {label: 'Device stored', value: 'PROCESSING_STORED'}
];

export const KIT_STATUS_LABELS_WITH_DISABLED = [
  {label: 'New device registered', value: 'DONATION_NEW'},
  {label: 'Device received into CTA', value: 'PROCESSING_START'},
  {label: 'Device wiped', value: 'PROCESSING_WIPED'},
  {label: 'OS installed', value: 'PROCESSING_OS_INSTALLED'},
  {label: 'Assessment check completed - ready for allocation', value: 'ALLOCATION_READY', disabled: 'true'},
  {label: 'Quality check completed', value: 'ALLOCATION_QC_COMPLETED', disabled: 'true'},
  {label: 'Collection/drop off to beneficiary arranged', value: 'ALLOCATION_DELIVERY_ARRANGED', disabled: 'true'},
  {label: 'Device received by beneficiary', value: 'DISTRIBUTION_DELIVERED', disabled: 'true'},
  {label: 'Device recycled', value: 'DISTRIBUTION_RECYCLED'},
  {label: 'Device in for repair', value: 'DISTRIBUTION_REPAIR_RETURN'},
  {label: 'Device stored', value: 'PROCESSING_STORED'}
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
    batteryHealth
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
        id
        referringOrganisation {
          id
          name
        }
      }
    }
    attributes {
      credentials
      status
      notes
      network
      state
      otherType
    }
    notes {
      id
      content
      volunteer
      createdAt
      updatedAt
    }
    subStatus {
      installationOfOSFailed
      wipeFailed
      needsSparePart
      needsFurtherInvestigation
      network
      installedOSName
      lockedToUser
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
    batteryHealth
    donor {
      id
      name
      email
      phoneNumber
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
    attributes {
      credentials
      status
      notes
      network
      state
      otherType
    }
    notes {
      id
      content
      volunteer
      createdAt
      updatedAt
    }
    subStatus {
      installationOfOSFailed
      wipeFailed
      needsSparePart
      needsFurtherInvestigation
      network
      installedOSName
      lockedToUser
    }
  }
}
`;

const DELETE_ENTITY = gql`
mutation deleteKit($id: ID!) {
  deleteKit(id: $id)
}
`;

const AUTOCOMPLETE_DONORS = gql`
query findAutocompleteDonors($term: String) {
  donorsConnection(page: {
    size: 50
  }, where: {
    id: { _contains: $term }
    OR: { name: { _contains: $term } }
  }){
    content  {
     id
     name
    }
  }
}
`;

const AUTOCOMPLETE_DEVICE_REQUESTS = gql`
query findAutocompleteDeviceRequests($term: String, $numericterm: Long) {
  deviceRequestConnection(page: {
    size: 50
  }, where: {
    id: {
      _eq: $numericterm
    }
    OR: [
    { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } },
    { referringOrganisationContact: { fullName: { _contains: $term } } },
    { clientRef: { _contains: $term } }
    ]
  }){
    content  {
     id
     clientRef
     referringOrganisationContact {
      id
      fullName
      referringOrganisation {
        id
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
    private lightbox: Lightbox,
    private titleService: Title
  ) {
    titleService.setTitle("TaDa - Device Info");
  }

  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {};
  model: any = {};
  deviceModel = {};
  entityName: string;
  entityId: number;
  disabledStatuses: boolean = false;

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

  statusField: FormlyFieldConfig = {
    key: 'status',
    type: 'radio',
    className: 'col-md-4 kit-status',
    defaultValue: 'DONATION_NEW',
    templateOptions: {
      label: 'Status of the device',
      options: KIT_STATUS_LABELS,
      required: true
    },
    validation: {
      show: true,
    },
    expressionProperties: {
      'templateOptions.options': (model, state, field) => {
        if(this.disabledStatuses) {
          return KIT_STATUS_LABELS_WITH_DISABLED;
        } else {
          return KIT_STATUS_LABELS;
        }
      },
      'validation.show': 'model.showErrorState'
    }
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
          },
          hideExpression: (model, state, field) => {
            const data = field.parent.formControl.value || {};
            const unSupportedDevices = ['OTHER','COMMSDEVICE'];
            return unSupportedDevices.includes(data['type']);
          },
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
          },
          hideExpression: (model, state, field) => {
            const data = field.parent.formControl.value || {};
            const unSupportedDevices = ['OTHER','COMMSDEVICE','PHONE','TABLET'];
            return unSupportedDevices.includes(data['type']);
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
          },
          hideExpression: (model, state, field) => {
            const data = field.parent.formControl.value || {};
            const unSupportedDevices = ['OTHER'];
            return unSupportedDevices.includes(data['type']);
          }
        },
        {
          key: 'tpmVersion',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "TPM Version",
            type: "number",
            descriptor: "",
            readonly: true
          },
          hideExpression: (model, state, field) => {
            const data = field.parent.formControl.value || {};
            const unSupportedDevices = ['OTHER','COMMSDEVICE','PHONE','TABLET'];
            return unSupportedDevices.includes(data['type']);
          }
        },
        {
          key: 'batteryHealth',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "Battery Health",
            type: "number",
            descriptor: ""
          },
          expressionProperties: {
            'templateOptions.bgcolor': (model, state, field) => {
              const data = field.parent.formControl.value || {};
              const health = data['batteryHealth'];
              if (health >= 75) {
                return 'green';
              } else if(health >= 50) {
                return 'yellow';
              } else if(health >= 25) {
                return 'orange';
              } else {
                return 'red';
              }
            }
          },
          hideExpression: (model, state, field) => {
            const data = field.parent.formControl.value || {};
            const unSupportedDevices = ['OTHER','COMMSDEVICE'];
            return unSupportedDevices.includes(data['type']);
          }
        },
        {
          key: 'serialNo',
          type: 'kit-info-input',
          className: 'px-1',
          defaultValue: '',
          templateOptions: {
            label: "Serial Number"
          }
        },
        this.donorField
      ]
    },
    {
      fieldGroupClassName: 'row border-bottom border-top d-flex p-2 mb-3',
      fieldGroup: [
        {
          key: 'make',
          type: 'input',
          className: 'col-md-2',
          defaultValue: '',
          templateOptions: {
            label: 'Make',
            rows: 2,
            placeholder: '',
            required: false
          }
        },
        {
          key: 'model',
          type: 'input',
          className: 'col-md-2',
          defaultValue: '',
          templateOptions: {
            label: 'Model',
            rows: 2,
            placeholder: '',
            required: true
          }
        },
        this.deviceRequestField
      ]
    },
    {
      fieldGroupClassName: 'row border-bottom-warning bordered p-2 mb-3',
      fieldGroup: [
        this.statusField,
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between text-right',
          className: 'col-md-4',
          fieldGroup: [
            {
              key: 'subStatus.network',
              type: 'choice',
              className: 'text-left',
              templateOptions: {
                label: 'Network provider?',
                description: '',
                items: [
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
              hideExpression: 'model.type != \'SMARTPHONE\''
            },
            {
              key: 'subStatus.network',
              type: 'choice',
              className: 'text-left',
              templateOptions: {
                label: 'Network provider?',
                description: '',
                items: [
                  {label: 'I don\'t know', value: 'UNKNOWN' },
                  {label: 'EE', value: 'EE' },
                  {label: 'O2', value: 'O2' },
                  {label: 'Three', value: 'Three' },
                  {label: 'Vodafone', value: 'Vodafone' },
                  {label: 'GiffGaff', value: 'GiffGaff' },
                  {label: 'Sky Mobile', value: 'SkyMobile' },
                  {label: 'Tesco Mobile', value: 'TescoMobile' },
                  {label: 'BT Mobile', value: 'BTMobile' },
                  {label: 'Virgin Mobile', value: 'VirginMobile' },
                  {label: 'Talk Talk', value: 'TalkTalk' },
                  {label: 'Other', value: 'OTHER' }
                ],
                required: true
              },
              hideExpression: 'model.type != \'COMMSDEVICE\''
            },
            {
                key: 'subStatus.installedOSName',
                type: 'choice',
                className: 'text-left',
                templateOptions: {
                  label: 'Installed OS',
                  description: 'What OS is installed on this device?',
                  type: 'array',
                  items: []
                },
                defaultValue: [],
                hideExpression: (model, state, field) => {
                  const data = field.parent.formControl.value || {};
                  const unSupportedDevices = ['OTHER','COMMSDEVICE'];
                  return unSupportedDevices.includes(data['type']);
                },
                expressionProperties: {
                  'templateOptions.items': (model, state, field) => {
                    const desktopOS = [
                      {label: 'Windows 11', value: 'WINDOWS_11'},
                      {label: 'Windows 10', value: 'WINDOWS_10'},
                      {label: 'Linux Mint', value: 'LINUX_MINT'},
                      {label: 'Mac OS', value: 'MAC_OS'},
                      {label: 'Chrome Flex', value: 'CHROME_FLEX'},
                      {label: 'Chrome OS', value: 'CHROME_OS'},
                      {label: 'Unsupported', value: 'UNSUPPORTED'}
                    ]
                    const phoneOS = [
                      {label: 'Android', value: 'ANDROID'},
                      {label: 'iOS', value: 'IOS'},
                      {label: 'Unsupported', value: 'UNSUPPORTED'}
                    ]
                    const props = {
                      'LAPTOP': desktopOS,
                      'TABLET': phoneOS,
                      'SMARTPHONE': phoneOS,
                      'ALLINONE': desktopOS,
                      'DESKTOP': desktopOS,
                    };
                    let values = props[model['type']];

                    return values;
                    },
                },
            },
            {
              key: 'subStatus.lockedToUser',
              type: 'kit-checkbox',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Locked to user?',
                required: false,
                change: (field, $event) => {
                  const data = field.parent.formControl.value || {};
                  this.updateDisabledStatusFlag(data);
                },
              },
              hideExpression: (model, state, field) => {
                const data = field.parent.formControl.value || {};
                const supportedDevices = ['SMARTPHONE','TABLET','OTHER'];
                return !(supportedDevices.includes(data['type']));
              },
              validation: {
                show: false
              }
            },
            {
              key: 'subStatus.wipeFailed',
              type: 'kit-checkbox',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Device wipe failed?',
                required: false,
                change: (field, $event) => {
                  const data = field.parent.formControl.value || {};
                  this.updateDisabledStatusFlag(data);
                },
              },
              hideExpression: (model, state, field) => {
                const data = field.parent.formControl.value || {};
                const supportedDevices = ['DESKTOP','LAPTOP','ALLINONE','OTHER'];
                return !(supportedDevices.includes(data['type']));
              },
              validation: {
                show: false
              }
            },
            {
              key: 'subStatus.installationOfOSFailed',
              type: 'kit-checkbox',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'OS Installation failed?',
                required: false,
                change: (field, $event) => {
                  const data = field.parent.formControl.value || {};
                  this.updateDisabledStatusFlag(data);
                },
              },
              hideExpression: 'model.type == \'COMMSDEVICE\'',
              validation: {
                show: false
              }
            },
            {
              key: 'subStatus.needsFurtherInvestigation',
              type: 'kit-checkbox',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Needs further investigation?',
                required: false,
                change: (field, $event) => {
                  const data = field.parent.formControl.value || {};
                  this.updateDisabledStatusFlag(data);
                },
              },
              validation: {
                show: false
              }
            },
            {
              key: 'subStatus.needsSparePart',
              type: 'kit-checkbox',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Needs spare part?',
                required: false,
                change: (field, $event) => {
                  const data = field.parent.formControl.value || {};
                  this.updateDisabledStatusFlag(data);
                },

              },
              validation: {
                show: false
              }
            },
          ]
        },
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-4',
          fieldGroup: [
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
            }
          ]
        }
      ]
    }
  ];

// {
//   key: 'attributes.otherType',
//   type: 'input',
//   className: '',
//   defaultValue: '',
//   templateOptions: {
//     label: 'Type of device',
//     rows: 2,
//     placeholder: '(Other device type)',
//     required: true
//   },
//   hideExpression: 'model.type != \'OTHER\'',
//   expressionProperties: {
//     'templateOptions.required': 'model.type == \'OTHER\'',
//   },
// },

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


//Do we still need this?
// {
//   key: 'attributes.otherNetwork',
//   type: 'input',
//   className: '',
//   defaultValue: '',
//   templateOptions: {
//     label: 'The other network the device is locked to',
//     rows: 2,
//     placeholder: '(Other Network)',
//     required: true
//   },
//   hideExpression: (model, state, field) => {
//     const data = (field.parent.formControl.value || {}).attributes || {};
//     return data['network'] != 'OTHER';
//   },
//   expressionProperties: {
//     'templateOptions.required': (model, state, field) => {
//       const data = (field.parent.formControl.value || {}).attributes || {};
//       return data['network'] == 'OTHER';
//     },
//   },
// },


// {
//   template: `
//   <div class="alert alert-warning shadow" role="alert">
//     Please ensure the donor has been updated with the reasons why
//     the donation has been <span class="badge badge-danger">DECLINED<span>
//   </div>
//   `,
//   hideExpression: 'model.status != \'DECLINED\''
// },

// {
//   template: `
//   <div class="row">
//     <div class="col-md-12">
//       <div class="border-bottom-info card mb-3 p-3">
//         <strong><p>About your device</p></strong>
//         <p>
//           In order to understand what condition your device is in - and how easy it will be for us
//           to get it ready to deliver - please answer as many of the following questions as you can.
//         </p>
//       </div>
//     </div>
//   </div>
//   `
// },

  updateDisabledStatusFlag(data: any) {
    this.disabledStatuses = data['subStatus']['needsFurtherInvestigation'] || data['subStatus']['needsSparePart'] || data['subStatus']['installationOfOSFailed'] || data['subStatus']['wipeFailed'] || data['subStatus']['lockedToUser'];

    const disabledStatusGroup = ['ALLOCATION_DELIVERY_ARRANGED','ALLOCATION_QC_COMPLETED','ALLOCATION_READY','DISTRIBUTION_DELIVERED'];
    var currentStatus = data['status'];

    if(this.disabledStatuses && disabledStatusGroup.includes(currentStatus)) {
      console.log('Invalidating');
      setTimeout(() => this.statusField.formControl.setErrors({incorrect: true, serverError: { message: "Error"}}));
      this.statusField.formControl.markAsTouched();
      this.toastr.error(`
        <small></small>
        `, 'Choose a valid status', {
          enableHtml: true,
          disableTimeOut: true
        });
    } else {
      this.form.get('status').setErrors(null);
      if(this.toastr.currentlyActive > 0) {
        this.toastr.remove(this.toastr.toasts[0].toastId);
      }
    }
  }

  private queryRef = this.apollo
    .watchQuery({
      query: QUERY_ENTITY,
      variables: {}
    });

  private normalizeData(data: any) {
    if (data.donor && data.donor.id) {
      data.donorId = data.donor.id;
      this.donorField.templateOptions['items'] = [
        {label: this.donorName(data.donor), value: data.donor.id}
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

  private formatMakeAndModel(make: string, model: string) {
    return `${make || ''}||${model || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' ')
      .trim();
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
        this.entityName = this.formatMakeAndModel(this.model['make'], this.model['model']);
        this.updateDisabledStatusFlag(data);
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
                label: `${this.donorName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
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
          numericterm: isNaN(Number(term)) ? -1 : Number(term)
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
      this.titleService.setTitle(`TaDa - Device ${this.entityId}`);
      this.fetchData();
    });

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
      })
    );

    this.sub.add(this.donors$.subscribe(data => {
      this.donorField.templateOptions['items'] = data;
    }));

    this.sub.add(this.deviceRequests$.subscribe(data => {
      this.deviceRequestField.templateOptions['items'] = data;
    }));
  }

  donorName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  organisationName(data) {
    return `${data.referringOrganisationContact.referringOrganisation.name || ''}||${data.referringOrganisationContact.fullName || ''}||${data.id || ''}`
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
    console.log(this.form.invalid);
    data.id = this.entityId;

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
      this.entityName = this.formatMakeAndModel(this.model['make'], this.model['model']);
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
