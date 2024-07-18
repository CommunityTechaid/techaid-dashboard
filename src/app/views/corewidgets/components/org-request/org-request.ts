import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription, concat, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
// import { FormGroup } from '@angular/forms';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { FormGroup, ValidationErrors, AbstractControl } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { isInteger } from '@ng-bootstrap/ng-bootstrap/util/util';
import { UpdateFormDirty } from '@ngxs/form-plugin';
import { Select } from '@ngxs/store';

const CREATE_ENTITY = gql`
mutation createOrganisation($data: CreateOrganisationInput!) {
  createOrganisation(data: $data){
     id
  }
}
`;

const CREATE_REFERRING_ORGANISATION = gql`
mutation createReferringOrganisation($data: CreateReferringOrganisationInput!) {
  createReferringOrganisation(data: $data){
     id
  }
}
`;

const QUERY_CONTENT = gql`
query findContent {
  post(where: {slug: {_eq: "/organisation-device-request"}}){
    id
    content
  }
}`;



// export function threeItemsValidator (c: AbstractControl) {
//   const vals = Object.values(c.value.attributes.request);
//   if (vals.length > 0 && (vals.reduce((a: number, b: number) => a + b)) > 3) {
//       return null;
//     }
//   return true;
// }

const AUTOCOMPLETE_REFERRING_ORGANISATION = gql`
query findAutocompleteReferringOrgs($term: String) {
  referringOrganisationsPublic(where: {
      name: {
        _contains: $term
      }
  }){

     id
     name

  }
}
`;

const FIND_ORGANISATION_CONTACT = gql`
query findOrganisationContact($fullName: String, $email: String) {
  referringOrganisationContact( where: {
      fullName: { _ilike: $fullName }
      email: { _ilike: $email }
    }){
    id
  }
}
`;

const CREATE_REFERRING_ORGANISATION_CONTACT = gql`
mutation createReferringOrganisationContact($data: CreateReferringOrganisationContactInput!) {
  createReferringOrganisationContact(data: $data){
     id
  }
}
`;

const CREATE_DEVICE_REQUEST = gql`
mutation createDeviceRequest($data: CreateDeviceRequestInput!) {
  createDeviceRequest(data: $data){
     id
  }
}
`;



@Component({
  selector: 'org-request',
  styleUrls: ['org-request.scss'],

  templateUrl: './org-request.html'
})



export class OrgRequestComponent {
  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {};
  submiting = false;
  content: any = {};
  model: any = {
    showErrorState: false,
  };
  submited = false;


  //TODO: not the ideal way to refresh the form, but it'll do for now
  reloadCurrentPage() {
    window.location.reload();
  }


  isOrganisationExists = true;
  isContactExists = true;
  newOrganisationName = ""


  //Review and remove
  referringOrgs$: Observable<any>;
  referringOrgInput = new Subject<string>();
  referringOrgLoading = false;
  referringOrgField: FormlyFieldConfig = {
    key: 'organisationId',
    type: 'choice',
    className: 'px-2 ml-auto justify-content-end',
    hooks: {
      onInit: (field) => {
        this.sub.add(field.formControl.valueChanges.subscribe(v => {
          if (!this.isOrganisationExists) {
            (this.referringOrganisationDetailFormGroup.fieldGroup[0].formControl.setValue(v));
          }else{
            this.referringOrgIdField.formControl.setValue(v)
          }
        }));
      }
    },
    templateOptions: {
      label: 'Organisation Name',
      description: 'Type atleast three letters of the name of your organisation',
      loading: this.referringOrgLoading,
      typeahead: this.referringOrgInput,
      placeholder: 'Start typing the name of your organisation',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };


  /**
   * NEW REFERRING ORGANISATION
   * These fields collect details of a new organisation and is displayed only
   * if the organisation search results return no results
   */
  referringOrganisationDetailFormGroup: FormlyFieldConfig = {
    fieldGroupClassName: 'row',
    hideExpression: true,
    fieldGroup: [
      {
        key: 'referringOrganisation.name',
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Organisation Name',
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
        key: 'referringOrganisation.website',
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Organisation website',
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
        key: 'referringOrganisation.address',
        type: 'place',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          placeholder: 'Organisation Address',
          postCode: false,
          required: true
        },
        validation: {
          show: false
        },
        expressionProperties: {
          'validation.show': 'model.showErrorState'
        }
      },
      {
        key: 'referringOrganisation.phoneNumber',
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Organisation phone number',
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
        type: 'button',
        templateOptions: {
          text: 'Submit',
          onClick: () => {
            this.saveNewReferringOrganisation().then(success => {
              if (success) {
                this.isOrganisationExists = true;
                this.showContactPage();
              }
            });
          },
        },
      }
    ]
  };

  //hidden field for ID of the referringOrganisation
  referringOrgIdField: FormlyFieldConfig = {
    key: 'referringOrganisationId',
    defaultValue: null,
    templateOptions: {
      label: '',
      required: true,
      hidden: true
    }
  }

  //hidden field for the ID of the referringContact 
  referringContactIdField: FormlyFieldConfig = {
    key: 'referringOrganisationContactId',
    defaultValue: null,
    templateOptions: {
      label: '',
      required: true,
      hidden: true
    }
  }

  /**
   * NEW REFERRING ORGANISATION CONTACT
   * These fields collect details of a new organisation contact and is displayed only
   * if the contact with the entered name and email ID cannot be found
   */
  referringOrganisationContactDetailFormGroup: FormlyFieldConfig = {
    fieldGroupClassName: 'row',
    hideExpression: this.isOrganisationExists && this.isContactExists,
    fieldGroup: [
      {
        hideExpression: !this.isOrganisationExists,
        className: 'col-md-12',
        template: `<div class="border-bottom-info card mb-3 p-3">
        <p>It looks like you haven’t made a request with us before, please check your details and fill in some additional information below.</p>
  </div>`
      },
      {
        key: 'referringOrganisationContact.phoneNumber',
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Your phone number',
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
        key: 'referringOrganisationContact.address',
        type: 'place',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Your address',
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
        type: 'button',
        templateOptions: {
          text: 'Submit',
          onClick: () => {
            this.saveNewReferringOrganisationContact().then(success => {
              if (success) {
                this.isContactExists = true;
                this.showRequestPage();
              }
            });
          }
        },
      }
    ]
  };


/**
 * REFERRING ORGAQNISATION CONTACT FULL NAME AND EMAIL 
 */
  fullNameField: FormlyFieldConfig = {
    key: 'referringOrganisationContact.fullName',
    type: 'input',
    className: 'col-md-12',
    defaultValue: '',
    templateOptions: {
      label: '',
      placeholder: 'Please enter your full name eg: John Doe',
      required: true
    },
    hooks: {
      onInit: (field) => {
        this.sub.add(field.formControl.valueChanges.subscribe(v => {
          this.isContactExists = true;
          this.refContactSubmitButton.hideExpression = false
          this.referringOrganisationContactDetailFormGroup.hideExpression = true;
        }));
      }
    },
    validation: {
      show: false
    },
    expressionProperties: {
      'validation.show': 'model.showErrorState',
    }
  }
  emailField: FormlyFieldConfig = {
    key: 'referringOrganisationContact.email',
    type: 'input',
    className: 'col-md-12',
    defaultValue: '',
    templateOptions: {
      label: '',
      placeholder: 'Your email address',
      required: true
    },
    hooks: {
      onInit: (field) => {
        this.sub.add(field.formControl.valueChanges.subscribe(v => {
          this.isContactExists = true;
          this.refContactSubmitButton.hideExpression = false
          this.referringOrganisationContactDetailFormGroup.hideExpression = true;
        }));
      }
    },
    validation: {
      show: false
    },
    expressionProperties: {
      'validation.show': 'model.showErrorState',
    }
  }

  refContactSubmitButton: FormlyFieldConfig = {
    hideExpression: !this.isOrganisationExists,
    type: 'button',
    templateOptions: {
      text: 'Submit',
      onClick: () => this.getRefContact(),
    },
  }

  /**
   * COLLECTION OF ALL THE FIELDS OF REFERRING ORGANISATION CONTACT 
   *
   */
  refContactPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [

      this.fullNameField,
      this.emailField,
      this.refContactSubmitButton,
      this.referringOrganisationContactDetailFormGroup
    ]
  };

  /**
   * COLLECTION OF ALL THE FIELDS OF REFERRING ORGANISATION 
   *
   */
  refOrganisationPage: FormlyFieldConfig = {
    fieldGroup: [
      {
        className: 'col-md-12',
        template: '<h6 class="m-0 font-weight-bold text-primary">About your organisation</h6>'
      },
      this.referringOrgField,
      this.referringOrganisationDetailFormGroup
    ]
  }

   /**
   * COLLECTION OF ALL THE FIELDS OF DEVICE REQUESTS
   *
   */
  requestPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'col-md-12',
        template: '<h6 class="m-0 font-weight-bold text-primary">Your client\'s needs</h6>'
      },
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          {
            key: 'deviceRequestItems',
            type: 'repeat',
            className: 'col-md-6',
            defaultValue: [{}],
            templateOptions: {
              description: 'If your client needs another item, use this button ➜',
              addText: 'Request another item',
              removeText: 'Remove this item',
              required: true,
              min: 1,
              maxItems: 1
            },
            fieldArray: {
            key: 'item',
            type: 'radio',
            className: '',
            templateOptions: {
              label: 'Please select the item your client needs.',
              description: 'If your client needs a SIM card in addition to a device, please select the main device above. Then tell us in the notes below that you also need a SIM card.',
              options: [
                // TODO: find some way to derive these from requestedItems so it's
                // all defined in one place
                { value: 'laptops', label: 'Laptop' },
                { value: 'desktops', label: 'Desktop computer' },
                {value: 'phones', label: 'Smartphone'},
                //{ value: 'commsDevices', label: 'SIM card (6 months, 20GB data, unlimited UK calls)' },
                // {value: 'tablets', label: 'Tablet' },
                
                ],
                required: true
              },
              // // validation: {
              //   show: false
              // },
              // expressionProperties: {
              //   'validation.show': 'model.showErrorState',
              // }              
              //   }
              // ]
            }
          }
        ]
      },
      {
        key: 'details',
        type: 'textarea',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: 'In order to support you as best as possible, please provide us with a brief overview of who this request is for, why they need a device and what they hope to do with it. Please do not include any identifiable details such as names or addresses but any background you can provide would be extremely helpful.',
          rows: 3,
          required: false
        }
      },
      {
        key: 'clientRef',
        type: 'input',
        className: 'col-md-3',
        defaultValue: '',
        templateOptions: {
          label: 'For your records, enter your client\'s initials or a client reference',
          // TODO: should this be required
          required: false
        }
      },
      {
        key: 'deviceRequestNeeds.hasInternet',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client have access to the internet at home?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
            { value: null, label: 'Don\'t know' }
          ],
          required: true
        }
      },
      {
        key: 'deviceRequestNeeds.hasMobilityIssues',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client have mobility issues, such as not being able to leave their home, or finding it difficult to do so?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
            { value: null, label: 'Don\'t know' }
          ],
          required: true
        }
      },
      {
        key: 'deviceRequestNeeds.needQuickStart',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client need a Quickstart session or other training in basic use of a computer, phone, or tablet?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
            { value: null, label: 'Don\'t know' }
          ],
          required: true
        }
      },
      {
        type: 'button',
        templateOptions: {
          text: 'Submit',
          onClick: () => {
            this.createNewDeviceRequest().then((success: boolean) => {
              if (success) {
              }
            });
          }
        },
      }
    ]
  }


  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroup: [
        this.refOrganisationPage,
        this.refContactPage,
        this.requestPage
      ]
    },
    this.referringOrgIdField,
    this.referringContactIdField
  ];

  constructor(
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }

  private normalizeData(data: any) {
    data.attributes.request = {
      'laptops': 0,
      'phones': 0,
      'commsDevices': 0,
      'tablets': 0,
      'desktops': 0
    };
    data.items.forEach(i => {
      data.attributes.request[i] = data.attributes.request[i] + 1;
    });

    // the accepts attribute appears to be just an upcased and de-duped array of
    // requested items
    data.attributes.accepts =
      Array.from(new Set(data.items.map(i => i.toUpperCase())));
    delete data.items;

    // This is a bit kludgey, but it turns out to be far easier to deal with
    // clients' needs as a list of needs rather than yes/know/don't know for each
    // item (mainly because of the don't know), but at the same time we want to
    // make it a mandatory field. So we transform the individual items:
    var needs = [];
    if (data.hasInternetHome == 'no') {
      needs.push('internet');
    }
    if (data.hasMobilityNeeds == 'yes') {
      needs.push('mobility');
    }
    if (data.hasTrainingNeeds == 'yes') {
      needs.push('training');
    }
    data.attributes.needs = needs;
    delete data.hasInternetHome;
    delete data.hasMobilityNeeds;
    delete data.hasTrainingNeeds;

    return data;
  }

  organisationName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  ngOnInit() {
    this.apollo.query({
      query: QUERY_CONTENT
    }).toPromise().then(res => {
      if (res.data) {
        this.content = res.data['post'];
      }
    });



    const orgRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_REFERRING_ORGANISATION,
        variables: {
        }
      });

    const contactRef = this.apollo
      .watchQuery({
        query: FIND_ORGANISATION_CONTACT,
        variables: {

        }
      })

    this.referringOrgs$ = concat(
      of([]),
      this.referringOrgInput.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => {
          this.referringOrgLoading = true;
        }
        ),
        switchMap(term => {
          if (term && term.length >= 3) {
            return from(orgRef.refetch({
              term: term
            })).pipe(
              catchError(() => of([])),
              tap(() => this.referringOrgLoading = false),
              switchMap(res => {
                console.log(res['data'])
                var data = res['data']['referringOrganisationsPublic'].map(v => {
                  return {
                    label: v.name, value: v.id
                  };
                });

                if (data.length == 0) {
                  this.hideNewOrganisationField(false);
                  data = [{
                    label: 'Use "' + term + '"', value: term, display: term
                  }];
                } else {
                  this.hideNewOrganisationField(true);
                  this.showContactPage();
                }
                return of(data);
              })
            )
          } return []
        })
      )
    );

    this.sub = this.referringOrgs$.subscribe(data => {
      this.referringOrgField.templateOptions['items'] = data;
    });

  }

  async saveNewReferringOrganisation(): Promise<boolean> {

    var data = this.referringOrganisationDetailFormGroup.formControl.value["referringOrganisation"];
    return this.apollo.mutate({
      mutation: CREATE_REFERRING_ORGANISATION,
      variables: { data }
    }).toPromise().then(res => {

      var data = res["data"]["createReferringOrganisation"]["id"];
      if (data) {
        this.toastr.info("Your organisation details were saved.")
        this.referringOrgIdField.formControl.setValue(data);
        return true;
      } else {
        this.toastr.error("Could not create the organisation.");
        return false;
      }
    }).catch(error => {
      this.toastr.error("An error occurred while creating the organisation.");
      console.error(error);
      return false;
    });

  }

  async saveNewReferringOrganisationContact(): Promise<boolean> {

    var contactDetails:any = this.referringOrganisationContactDetailFormGroup.formControl.value.referringOrganisationContact;
    contactDetails.referringOrganisation = this.referringOrgIdField.formControl.value
    var data = contactDetails;

    return this.apollo.mutate({
      mutation: CREATE_REFERRING_ORGANISATION_CONTACT,
      variables: { data }
    }).toPromise().then(res => {

      var data = res["data"]["createReferringOrganisationContact"]["id"];
      if (data) {
        this.toastr.info("Your contact details were saved.")
        this.referringContactIdField.formControl.setValue(data);
        return true;
      } else {
        this.toastr.error("Could not save your contact details.");
        console.log(res);
        return false;
      }
    }).catch(error => {
      this.toastr.error("An error occurred while trying to save your contact details.");
      console.error(error);
      return false;
    });

  }

  getRefContact() {

    this.apollo.query({
      query: FIND_ORGANISATION_CONTACT,
      variables: {
        fullName: this.fullNameField.formControl.value,
        email: this.emailField.formControl.value
      }
    }).toPromise().then(res => {

      var data = res["data"]["referringOrganisationContact"];
      if (data) {
        this.referringContactIdField.formControl.setValue(data["id"]);
        this.isContactExists = true;
        this.showRequestPage();
      } else {
        this.refContactSubmitButton.hideExpression = true
        this.hideNewContactRefDetailsField(false);
      }
    });


  }

  showRequestPage() {
    this.referringOrgField.hideExpression = true;
    this.refOrganisationPage.hideExpression = true;
    this.refContactPage.hideExpression = true;
    this.requestPage.hideExpression = false;
  }

  showOrganisationPage() {
    this.referringOrgField.hideExpression = false;
  }

  showContactPage() {


    this.referringOrganisationDetailFormGroup.hideExpression = this.isOrganisationExists;

    this.refContactPage.hideExpression = false;

    if (!this.isContactExists) {
      this.referringOrganisationContactDetailFormGroup.hideExpression = false;
      this.refContactSubmitButton.hideExpression = true;
    } else {
      this.refContactSubmitButton.hideExpression = false;
    }
  }

  hideNewOrganisationField(hide: boolean) {
    this.isOrganisationExists = hide;
    this.isContactExists = hide;
    this.referringOrganisationDetailFormGroup.hideExpression = this.isOrganisationExists;
    this.refContactPage.hideExpression = !this.isOrganisationExists;
  }

  hideNewContactRefDetailsField(hide: boolean) {
    this.isContactExists = hide;
    this.referringOrganisationContactDetailFormGroup.hideExpression = this.isContactExists;
  }


  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  setDeviceRequestItems(deviceRequestItems: any) {

    const payload: any = {};

    for (var device of deviceRequestItems) {
      payload[device] = 1;
    }

    return payload;


  }

  createNewDeviceRequest(){
    const deviceRequest:any = this.requestPage.formControl.value;
    const data: any = {
      clientRef: deviceRequest.clientRef,
      deviceRequestNeeds: deviceRequest.deviceRequestNeeds,
      details: deviceRequest.details,
      referringOrganisationContact: deviceRequest.referringOrganisationContactId,
      deviceRequestItems: this.setDeviceRequestItems(deviceRequest.deviceRequestItems)
  };

    return this.apollo.mutate({
      mutation: CREATE_DEVICE_REQUEST,
      variables: { data }
    }).toPromise().then(res => {

      var data = res["data"]["createDeviceRequest"]["id"];
      if (data) {
        this.toastr.info("Your request was made succesfully.")
        return true;
      } else {
        this.toastr.error("Could not create your request.");
        console.log(res);
        return false;
      }
    }).catch(error => {
      this.toastr.error("An error occurred while trying to create the request");
      console.error(error);
      return false;
    });
  }

  createEntity(data: any) {
    data = this.normalizeData(data);
    //    console.log(data);

    if (this.form.invalid) {
      this.model.showErrorState = true;
      return false;
    }
    this.submiting = true;
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.submited = true;
      this.submiting = false;
      this.model = {};
    }, err => {
      this.submiting = false;
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Organisation Error', {
        enableHtml: true,
        timeOut: 15000
      });
    });
  }
}
