import { Component, ViewChild, ViewEncapsulation, ElementRef, Renderer2, ChangeDetectorRef, NgZone } from '@angular/core';
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
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

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


const AUTOCOMPLETE_REFERRING_ORGANISATION = gql`
query findAutocompleteReferringOrgs($term: String) {
  referringOrganisationsPublic(where: {
      name: {
        _contains: $term
      },
      archived: {
        _eq: false
      }
  }){
     id
     name
  }
}
`;

const FIND_ORGANISATION_CONTACT = gql`
query findOrganisationContact($email: String, $refOrgId: Long) {
  referringOrganisationContactsPublic( where: {
      email: { _ilike: $email }
      referringOrganisation: { id: { _eq: $refOrgId } }
      archived: { _eq: false }
    }){
      id
      fullName
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
  styleUrls: ['./org-request.scss'],
  templateUrl: './org-request.html'
})

export class OrgRequestComponent {
  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {};
  submitting = false;
  content: any = {};
  model: any = {
    showErrorState: false,
  };
  submited = false;
  tfSubmitted = false;
  responseId = null;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;
  isOrgAdmin = false;

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

          this.referringOrganisationContactsDropDown.fieldGroup[0].templateOptions['options'] = []
          this.referringOrganisationContactsDropDown.hideExpression = true;
          this.createNewOrganisationContactPrompt.hideExpression = true;
          if (!this.isOrganisationExists) {
            (this.referringOrganisationDetailFormGroup.fieldGroup[0].formControl.setValue(v));
          } else {
            this.referringOrgIdField.formControl.setValue(v)
          }
        }));
      }
    },
    templateOptions: {
      label: 'Organisation Name',
      description: 'Type at least three letters of the name of your organisation',
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
          minLength: 3,
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
          pattern: /^(https?:\/\/)?([\w\d-_]+)\.([\w\d-_\.]+)\/?\??([^#\n\r]*)?#?([^\n\r]*)/,
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
      /*       {
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
            }, */
      {
        key: 'referringOrganisation.phoneNumber',
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          pattern: /^(((\+44\s?\d{4}|\(?0\d{4}\)?)\s?\d{3}\s?\d{3})|((\+44\s?\d{3}|\(?0\d{3}\)?)\s?\d{3}\s?\d{4})|((\+44\s?\d{2}|\(?0\d{2}\)?)\s?\d{4}\s?\d{4}))(\s?\#(\d{4}|\d{3}))?$/,
          placeholder: 'Organisation phone number',
          required: false
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
                this.isOrganisationExists = false;
                this.showContactPage();
                this.referringOrganisationDetailFormGroup.hideExpression = true

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

  referringOrganisationContactProceedButton: FormlyFieldConfig = {

    hideExpression: true,
    type: 'button',
    templateOptions: {
      text: 'Proceed',
      onClick: () => {
        this.showRequestPage();
      }
    },

  }

  referringOrganisationContactsDropDown: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        //key: 'referringOrganisationContact',
        type: 'select',
        className: 'col-md-12',
        templateOptions: {
          label: 'Choose your name from the list below',
          options: [{
            label: "hello",
            value: "test"
          }],
          required: false
        },
        hooks: {
          onInit: (field) => {
            this.sub.add(field.formControl.valueChanges.subscribe(v => {
              this.referringOrganisationContactProceedButton.hideExpression = false;
              this.referringContactIdField.formControl.setValue(v)
              this.isContactExists = true;
            }));
          }
        }
      },
      this.referringOrganisationContactProceedButton
    ]

  }

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
          pattern: /^(((\+44\s?\d{4}|\(?0\d{4}\)?)\s?\d{3}\s?\d{3})|((\+44\s?\d{3}|\(?0\d{3}\)?)\s?\d{3}\s?\d{4})|((\+44\s?\d{2}|\(?0\d{2}\)?)\s?\d{4}\s?\d{4}))(\s?\#(\d{4}|\d{3}))?$/,
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
   * REFERRING ORGANISATION CONTACT FULL NAME AND EMAIL
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
          if (this.isOrganisationExists) {
            this.isContactExists = true;
            this.refContactSubmitButton.hideExpression = false
            this.referringOrganisationContactDetailFormGroup.hideExpression = true;
          }
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
    className: 'col-md-10',
    defaultValue: '',
    templateOptions: {
      label: '',
      type: 'email',
      placeholder: 'Your email address',
      pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
      required: true
    },
    /* hooks: {
      onInit: (field) => {
        this.sub.add(field.formControl.valueChanges.subscribe(v => {
          if (this.isOrganisationExists) {
            this.isContactExists = true;
            this.refContactSubmitButton.hideExpression = false
            this.referringOrganisationContactDetailFormGroup.hideExpression = true;
          }
        }));
      }
    }, */
    validation: {
      show: false
    },
    expressionProperties: {
      'validation.show': 'model.showErrorState',
    }
  }

  refContactSubmitButton: FormlyFieldConfig = {
    hideExpression: !this.isOrganisationExists,
    className: 'col-md-2',
    type: 'button',
    templateOptions: {
      text: 'Find Email',
      className: 'btn btn-info btn-sm p-2',
      onClick: () => this.getRefContact(),
    },
  }

  /**
   * COLLECTION OF ALL THE FIELDS OF REFERRING ORGANISATION CONTACT
   *
   */

  createNewOrganisationContactPrompt: FormlyFieldConfig = {
    hideExpression: true,
    className: 'col-md-12',
    template: `<div class="border-bottom-danger card mb-3 p-3">
<p>The email you entered isn’t in our system. Please double-check the address for accuracy. If this is your first request, use <a class="btn btn-primary" role="button" href="https://ghjngk6ao4g.typeform.com/to/Qz4rILeN" target="_blank">this link</a> to provide your details so we can register you.</p>
<p>For any questions, contact <a href="mailto:distributions@communitytechaid.org.uk">distributions@communitytechaid.org.uk</a></p>
</div>`
  }

  refContactPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'col-md-12',
        template: '<h6 class="m-0 font-weight-bold text-primary">About you</h6>'
      },
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          this.emailField,
          this.refContactSubmitButton,
        ]
      },
      this.referringOrganisationContactsDropDown,
      this.createNewOrganisationContactPrompt,
      this.referringOrganisationContactDetailFormGroup
    ]
  };

  /**
   * Question to filter out non Lambeth requests
   *
   */
  isLambethErrorMessage: FormlyFieldConfig = {
    hideExpression: true,
    className: 'col-md-12',
    template: `<div class="border-bottom-info card mb-3 p-3">
<p>Unfortunately, we can only support people in Lambeth and Southwark currently.</p>
<p>For any questions, contact <a href="mailto:distributions@communitytechaid.org.uk">distributions@communitytechaid.org.uk</a></p>
</div>`
  }

  isLambethPage: FormlyFieldConfig = {
    hideExpression: false,
    fieldGroup: [
      {
        type: 'radio',
        className: '',
        hooks: {
          onInit: (field) => {
            this.sub.add(field.formControl.valueChanges.subscribe(v => {
              if (v) {
                this.refOrganisationPage.hideExpression = false;
                this.isLambethErrorMessage.hideExpression = true;
              } else {
                this.refOrganisationPage.hideExpression = true;
                this.isLambethErrorMessage.hideExpression = false;
              }
            }));
          }
        },
        templateOptions: {
          label: 'Does your client live in either Lambeth or Southwark?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' }
          ],
          required: true
        },
        validators: {
          mustBeTrue: {
            expression: (c: AbstractControl) => c.value,
            message: (error: any, field: FormlyFieldConfig) => ''
          }
        }
      },
      this.isLambethErrorMessage
    ]
  }


  /**
   * COLLECTION OF ALL THE FIELDS OF REFERRING ORGANISATION
   *
   */
  createNewOrganisationPrompt: FormlyFieldConfig = {
    hideExpression: true,
    className: 'col-md-12',
    template: `<div class="border-bottom-danger card mb-3 p-3">
<p>It looks like your organisation isn't listed in our system. Please use <a class="btn btn-primary" role="button" href="https://ghjngk6ao4g.typeform.com/to/Qz4rILeN" target="_blank">this link</a> to provide your details. If you think your organisation should be listed, try typing the first three letters again.</p>
<p>For any questions, contact <a href="mailto:distributions@communitytechaid.org.uk">distributions@communitytechaid.org.uk</a></p>
</div>`
  }

  refOrganisationPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'col-md-12',
        template: '<h6 class="m-0 font-weight-bold text-primary">About your organisation</h6>'
      },
      this.referringOrgField,
      this.createNewOrganisationPrompt,
      this.referringOrganisationDetailFormGroup
    ]
  }

  deviceRequestCreateButton: FormlyFieldConfig = {
    type: 'button',
    templateOptions: {
      text: 'Submit',
      disabled: this.submitting,
      onClick: () => {

        if (this.submitting) {
          return
        }

        this.submitting = true;

        this.createNewDeviceRequest()
          .then((success: boolean) => {
            if (success) {
              this.submitting = false;
              this.showThankYouPage()
            }
          })
          .finally(() => {
            this.submitting = false;
            this.deviceRequestCreateButton.templateOptions.disabled = this.submitting
          })
          ;
      }
    },
  }

  /**
  * COLLECTION OF ALL THE FIELDS OF DEVICE REQUESTS
  *
  */
  deviceTypesAdmin: FormlyFieldConfig = {
    key: 'deviceRequestItems',
    type: 'radio',
    className: 'col-md-6',
    templateOptions: {
      label: 'Please select the item your client needs. *',
      //description: 'If your client needs a SIM card in addition to a device, select the main device above and check the below box. If they just need a SIM card, only select the box below.',
      options: [
        // TODO: find some way to derive these from requestedItems so it's
        // all defined in one place
        { value: 'laptops', label: 'Laptop' },
        { value: 'desktops', label: 'Desktop computer' },
        { value: 'phones', label: 'Smartphone' },
        { value: 'commsDevices', label: 'SIM card (6 months, 20GB data, unlimited UK calls)' },
        { value: 'tablets', label: 'Tablet' },
        { value: 'other', label: 'Other' }
      ],
      required: false
    }
  }

  deviceTypesPublic: FormlyFieldConfig = {
    key: 'deviceRequestItems',
    type: 'radio',
    className: 'col-md-6',
    templateOptions: {
      label: 'Please select the item your client needs. *',
      //description: 'If your client needs a SIM card in addition to a device, select the main device above and check the below box. If they just need a SIM card, only select the box below.',
      options: [
        // TODO: find some way to derive these from requestedItems so it's
        // all defined in one place
        { value: 'laptops', label: 'Laptop' },
        // { value: 'desktops', label: 'Desktop computer' }, // Temp. disabling per Steph's request on Jan. 14, 2025

        //{ value: 'phones', label: 'Smartphone' },
        /* { value: 'commsDevices', label: 'SIM card (6 months, 20GB data, unlimited UK calls)' } */,
        // {value: 'tablets', label: 'Tablet' },

      ],
      required: false
    }
  }

  requestPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'col-md-12',
        template: '<h6 class="m-0 font-weight-bold text-primary">Your client\'s needs</h6>'
      },/*
      {
        className: 'col-md-12',
        template: '<p class="m-0">Please select the item your client needs. *</p>'
      }, */
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          this.deviceTypesPublic,
          this.deviceTypesAdmin,
          /*
          {
            className: 'col-md-12',
            template: '<div class="text-secondary"><span>If your client needs a SIM card in addition to a device, select the main device above and check the below box.</span><p>If they just need a SIM card, only select the box below.</p></div>'
          },
          */
          {
            key: 'isSimNeeded',
            type: 'checkbox',
            className: 'col-md-12',
            hideExpression: true,
            templateOptions: {
              label: 'SIM Card',
              required: false,
              defaultValue: false,
              indeterminate: false
            }

          },
        ]
      },
      {
        key: 'details',
        type: 'textarea',
        className: 'col-md-12 device-request-details',
        defaultValue: '',
        templateOptions: {
          label: 'In order to support you as best as possible, please provide us with a brief overview of who this request is for, why they need a device and what they hope to do with it. Please do not include any identifiable details such as names or addresses but any background you can provide would be extremely helpful.',
          placeholder: 'Please do not include any identifiable details',
          rows: 3,
          required: true
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
          required: true
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
          required: false
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
          required: false
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
          required: false
        }
      },
      this.deviceRequestCreateButton,
      {
        className: 'col-md-12',
        template: '<div class="text-secondary"><span>* By submitting this form, I confirm that I have obtained the necessary permission to share the information provided.</span></div>'
      }
    ]
  }

  thankYouPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'row',
        template: '<h3 class="font-weight-bold text-primary">Thank You</h3>'
      },
      {
        className: 'row',
        template: '<p class="">You will receive an email confirmation of your request shortly with the next steps. </p><p>If you haven’t received any email, or need to amend any details, please get in touch:</p>'
      },
      {
        className: 'row',
        template: '<p class="text-primary">020 3488 7742<br>distributions@communitytechaid.org.uk</p><p>Requests typically take 4-6 weeks to fulfill</p>'
      }
    ]
  }

  moreThanThreeRequestsPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      {
        className: 'row',
        template: '<h3 class="font-weight-bold text-primary">Oops!</h3>'
      },
      {
        className: 'row',
        template: '<p class="">It looks like you already have 3 open requests.</br> Please wait for these to be fulfilled before making another.</p>'
      }
    ]
  }


  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroup: [
        this.isLambethPage,
        this.refOrganisationPage,
        this.refContactPage,
        this.requestPage,
        this.thankYouPage,
        this.moreThanThreeRequestsPage
      ]
    },
    this.referringOrgIdField,
    this.referringContactIdField
  ];

  constructor(
    private toastr: ToastrService,
    private apollo: Apollo,
    private elementRef:ElementRef,
    private renderer: Renderer2,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone
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
          this.referringOrganisationContactDetailFormGroup.hideExpression = true
          if (term && term.length >= 3) {
            return from(orgRef.refetch({
              term: term
            })).pipe(
              catchError(() => of([])),
              tap(() => this.referringOrgLoading = false),
              switchMap(res => {
                var data = res['data']['referringOrganisationsPublic'].map(v => {
                  return {
                    label: v.name, value: v.id
                  };
                });

                if (data.length == 0) {
                  this.hideNewOrganisationField(false);
                  this.referringOrgField.formControl.setValue(null)

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

    this.sub.add(
      this.user$.subscribe((user) => {
        console.log('getting user');
        this.isOrgAdmin = (user && user.authorities && user.authorities['write:organisations']);
        this.deviceTypesPublic.hide = this.isOrgAdmin;
        this.deviceTypesAdmin.hide = !this.isOrgAdmin;

        console.log(this.isOrgAdmin, this.deviceTypesPublic.hide, this.deviceTypesAdmin.hide);
      })
    );

  }

  ngAfterViewInit(){


    // Submit function for TypeForm
    (window as any).submit = ({ formId, responseId }) => {
      console.log(`Form ${formId} submitted, response id: ${responseId}`);
      this.responseId = responseId;
      this.tfSubmitted = true;

     
      // Angular is not aware of field changes so we run detectChanges to force it
      this.ngZone.run(() => {
        this.changeDetectorRef.detectChanges();
      });
     

    };

    // Create the script element dynamically
    const script = this.renderer.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://embed.typeform.com/next/embed.js'; // Correct URL
    this.renderer.appendChild(this.elementRef.nativeElement, script);


  }


  async saveNewReferringOrganisation(): Promise<boolean> {

    //var address = this.referringOrganisationDetailFormGroup.fieldGroup.find(f => f.key ==="referringOrganisation.address").formControl.value
    var website = this.referringOrganisationDetailFormGroup.fieldGroup.find(f => f.key === "referringOrganisation.website").formControl.value
    if (!website) {
      this.toastr.error("Please fill in a website");
      return false

    }

    var nameField = this.referringOrganisationDetailFormGroup.fieldGroup.find(f => f.key === "referringOrganisation.name")
    var name = nameField.formControl.value
    if (!name) {
      this.toastr.error("Please fill in the name of your organisation");
      return false
    } else if (name.length < 3) {
      nameField.validation.show = true
      this.toastr.error("Name of organisation should be at least 3 characters.");
      return false
    }

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
      this.toastr.error(error.message.split(':')[1]);
      console.error(error);
      return false;
    });

  }

  async saveNewReferringOrganisationContact(): Promise<boolean> {

    var contactFormControl = this.referringOrganisationContactDetailFormGroup.formControl;

    var isValid: boolean = true
    for (var field of this.referringOrganisationContactDetailFormGroup.fieldGroup) {
      if (field.formControl.errors) {
        isValid = false;
        field.validation.show = true
      }
    }

    if (!isValid) {
      return

    }

    var contactDetails: any = contactFormControl.value.referringOrganisationContact;
    contactDetails.referringOrganisation = this.referringOrgIdField.formControl.value
    var data = contactDetails;
    Object.keys(data).forEach(k => data[k] = typeof data[k] == 'string' ? data[k].trim() : data[k]);
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
        return false;
      }
    }).catch(error => {
      this.toastr.error(error.message.split(':')[1]);
      console.error(error);
      return false;
    });

  }

  getRefContact() {

    if (this.emailField.formControl.errors) {
      this.emailField.validation.show = true;
      return;
    }

    this.referringOrganisationContactsDropDown.fieldGroup[0].templateOptions['options'] = []
    this.referringOrganisationContactsDropDown.hideExpression = true;
    this.createNewOrganisationContactPrompt.hideExpression = true;

    this.apollo.query({
      query: FIND_ORGANISATION_CONTACT,
      variables: {
        email: this.emailField.formControl.value.trim(),
        refOrgId: this.referringOrgIdField.formControl.value
      }
    }).toPromise().then(res => {

      var data = res["data"]["referringOrganisationContactsPublic"];

      if (data && data.length > 1) {
        const contacts = data.map((r) => {
          return { label: r.fullName, value: r.id };
        });

        this.referringOrganisationContactProceedButton.hideExpression = true;
        this.referringOrganisationContactsDropDown.hideExpression = false;
        this.referringOrganisationContactsDropDown.fieldGroup[0].templateOptions['options'] = contacts;

      } else if (data && data.length == 1) {
        this.referringContactIdField.formControl.setValue(data[0].id);
        this.isContactExists = true;
        this.showRequestPage();
      } else {
        this.createNewOrganisationContactPrompt.hideExpression = false;
      }
    });

  }

  showThankYouPage() {
    this.content = {}
    this.refOrganisationPage.hideExpression = true;
    this.refContactPage.hideExpression = true;
    this.requestPage.hideExpression = true;
    this.thankYouPage.hideExpression = false;
  }

  showMoreThanThreeRequestsPage() {
    this.content = {}
    this.refOrganisationPage.hideExpression = true;
    this.refContactPage.hideExpression = true;
    this.requestPage.hideExpression = true;
    this.moreThanThreeRequestsPage.hideExpression = false;
  }

  showRequestPage() {
    this.isLambethPage.hideExpression = true
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
    this.createNewOrganisationPrompt.hideExpression = hide;
    //this.referringOrganisationDetailFormGroup.hideExpression = this.isOrganisationExists;
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

  setDeviceRequestItems(deviceRequestItem: any, isSimNeeded: any = false) {


    var payload: any = {};


    if (deviceRequestItem) {
      payload[deviceRequestItem] = 1;
    }


    if (isSimNeeded === true) {
      payload['commsDevices'] = 1
    }

    return payload;


  }

  createNewDeviceRequest() {

    this.deviceRequestCreateButton.templateOptions.disabled = true;
    const deviceRequest: any = this.requestPage.formControl.value;

    var isValid = true
    for (var field of this.requestPage.fieldGroup) {
      if (field.formControl.errors) {
        isValid = false;
        field.validation.show = true
      }
    }

    if (!deviceRequest.clientRef) {
      this.toastr.error("Please fill in a client reference");
      return Promise.resolve(false)
    }


    var requestItems = this.setDeviceRequestItems(deviceRequest.deviceRequestItems, false) //deviceRequest.isSimNeeded)

    if (Object.keys(requestItems).length === 0) {
      this.toastr.error("Please select the item your client needs");
      return Promise.resolve(false)
    }

    if (!isValid) {
      return Promise.resolve(false)
    }

    const data: any = {
      clientRef: deviceRequest.clientRef,
      deviceRequestNeeds: deviceRequest.deviceRequestNeeds,
      details: deviceRequest.details,
      referringOrganisationContact: deviceRequest.referringOrganisationContactId,
      deviceRequestItems: requestItems
    };


    return this.apollo.mutate({
      mutation: CREATE_DEVICE_REQUEST,
      variables: { data }
    }).toPromise().then(res => {

      var data = res["data"]["createDeviceRequest"]["id"];
      if (data) {
        this.toastr.info("Your request was made successfully.")
        return true;
      } else {
        this.toastr.error("Could not create your request.");
        return false;
      }
    }).catch(error => {
      var message = error.message.split(':')[1]
      if (message.trim().startsWith("Could not create new requests. This user already has")) {
        this.showMoreThanThreeRequestsPage()
        return false;
      }
      this.toastr.error(message);
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
    this.submitting = true;
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.submited = true;
      this.submitting = false;
      this.model = {};
    }, err => {
      this.submitting = false;
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Organisation Error', {
        enableHtml: true,
        timeOut: 15000
      });
    });
  }
}
