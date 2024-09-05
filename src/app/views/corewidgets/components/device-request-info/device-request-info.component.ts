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
      deviceRequestItems {
        phones
        tablets
        laptops
        allInOnes
        desktops
        commsDevices
        other
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
  referringOrganisationId: number;
  referringOrganisationContactId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  newNoteField: FormlyFieldConfig = {
    key: 'deviceRequestNote.content',
    type: 'device-request-new-note',
    templateOptions: {
      placeholder: "Enter text and your initials. The current date and time will be automatically added to the note. Click the save button to save all your changes"
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
    className: 'px-2 ml-auto justify-content-end text-right',
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
            },
            this.newNoteField,
            this.notesField
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
