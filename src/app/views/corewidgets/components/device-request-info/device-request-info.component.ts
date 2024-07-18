import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
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
      deviceRequestItems {
        phones
        tablets
        laptops
        allInOnes
        desktops
        commsDevices
        other
      }
      isSales
      clientRef
      details
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
      deviceRequestItems {
        phones
        tablets
        laptops
        allInOnes
        desktops
        commsDevices
        other
      }
      isSales
      clientRef
      details
      deviceRequestNeeds {
        hasInternet
        hasMobilityIssues
        needQuickStart
      }
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteDeviceRequest($id: ID!) {
    deleteDeviceRequest(id: $id)
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
    private apollo: Apollo
  ) {}
  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  requestId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

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

//             {
//               key: 'name',
//               type: 'input',
//               className: '',
//               defaultValue: '',
//               templateOptions: {
//                 label: 'Organisation name',
// //                description: 'The name of the organisation',
//                 placeholder: '',
//                 required: true
//               },
//               validation: {
//                 show: false
//               },
//               expressionProperties: {
//                 'validation.show': 'model.showErrorState',
//               }
//             },
            // {
            //   key: 'contact',
            //   type: 'input',
            //   className: '',
            //   defaultValue: '',
            //   templateOptions: {
            //     label: 'Primary contact name',
            //     placeholder: '',
            //     required: true
            //   },
            //   validation: {
            //     show: false
            //   },
            //   expressionProperties: {
            //     'validation.show': 'model.showErrorState',
            //   }
            // },
            // {
            //   key: 'email',
            //   type: 'input',
            //   className: '',
            //   defaultValue: '',
            //   templateOptions: {
            //     label: 'Primary contact email',
            //     type: 'email',
            //     pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            //     placeholder: '',
            //     required: true
            //   },
            //   expressionProperties: {
            //     'templateOptions.required': '!model.phoneNumber.length'
            //   }
            // },
            // {
            //   key: 'phoneNumber',
            //   type: 'input',
            //   className: '',
            //   defaultValue: '',
            //   templateOptions: {
            //     label: 'Primary contact phone number',
            //     required: true
            //   },
            //   expressionProperties: {
            //     'templateOptions.required': '!model.email.length'
            //   }
            // },
            // {
            //   key: 'address',
            //   type: 'place',
            //   className: '',
            //   defaultValue: '',
            //   templateOptions: {
            //     label: 'Address',
            //     description: 'The address of the organisation',
            //     placeholder: '',
            //     postCode: false,
            //     required: true
            //   },
            //   expressionProperties: {
            //     'templateOptions.required': '!model.address.length'
            //   }
            // },
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
            }
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
                //       {
                //         className: '',
                //         template: `
                //   <p>How many of the following items can you currently take</p>
                // `
                //       },
                {
                  key: 'deviceRequestItems.laptops',
                  type: 'input',
                  className: '',
                  defaultValue: 0,
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
                    key: 'deviceRequestItems.other',
                    type: 'input',
                    className: '',
                    defaultValue: 0,
                    templateOptions: {
                      min: 0,
                      max: 5,
                      label: 'Other',
                      description: '',
                      addonLeft: {
                        class: 'fas fa-laptop-house'
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
                    templateOptions: {
                      min: 0,
                      max: 5,
                      label: 'Connectivity Devices',
                      description: '',
                      addonLeft: {
                        class: 'fas fa-laptop-house'
                      },
                      type: 'number',
                      placeholder: '',
                      required: true
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
            {
              key: 'deviceRequestNeeds.hasInternet',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Has no home internet',
                placeholder: '',
                required: false
              }
            },
            {
              key: 'deviceRequestNeeds.hasMobilityIssues',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Mobility issues',
                placeholder: '',
                required: false
              }
            },
            {
              key: 'deviceRequestNeeds.needQuickStart',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Training needs',
                placeholder: '',
                required: false
              }
            },
            {
              key: 'isSales',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Is this a commercial sale?',
                placeholder: '',
                required: false
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
    // Not currently doing any normalization
    return data;
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
    this.sub = this.activatedRoute.params.subscribe((params) => {
      this.requestId = +params['requestId'];
      this.fetchData();
    });
    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:organisations']);
      })
    );
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
}
