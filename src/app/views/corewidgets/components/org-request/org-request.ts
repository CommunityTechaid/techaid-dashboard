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
  referringOrganisationsConnection(page: {
    size: 50
  }, where: {
      name: {
        _contains: $term
      }
  }){
    content  {
     id
     name
     address
    }
  }
}
`;

const FIND_ORGANISATION_CONTACT = gql`
query findOrganisationContact($name: String, $surname: String, $email: String) {
  referringOrganisationContact( where: {
      firstName: { _ilike: $name }
      surname: { _ilike: $surname }
      email: { _ilike: $email }
    }){
    id
  }
}
`;

const NEW_ORG = "NEW_ORG";

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
              if (!this.isOrganisationExists){
                (this.referringOrganisationDetailFormGroup.fieldGroup[0].formControl.setValue(v));
              }
          }));
      }},
    templateOptions: {
      label: 'Organisation Name',
      description: 'Type the name of your organisation',
      loading: this.referringOrgLoading,
      typeahead: this.referringOrgInput,
      placeholder: 'Name of your organisation',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };


  referringOrganisationDetailFormGroup: FormlyFieldConfig = {
    fieldGroupClassName: 'row',
    hideExpression:'model.attributes.isIndividual == null || model.attributes.isIndividual == true',
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
        type: 'input',
        className: 'col-md-12',
        defaultValue: '',
        templateOptions: {
          label: '',
          placeholder: 'Organisation address',
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
        className: 'border',
        templateOptions: {
          text: 'Submit',
          onClick: () => {
            this.isOrganisationExists = true;
            this.showContactPage()},
        },
      }

    ]
  };

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
        key: 'phoneNumber',
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
        hideExpression: !this.isContactExists,
        type: 'button',
        className: 'border',
        templateOptions: {
          text: 'Submit',
          onClick: () => this.showRequestPage(),
        },
      }

    ]
  };

  firstNameField: FormlyFieldConfig = {
    key: 'firstName',
    type: 'input',
    className: 'col-md-12',
    defaultValue: '',
    templateOptions: {
      label: '',
      placeholder: 'Your first name',
      required: true
    },
    validation: {
      show: false
    },
    expressionProperties: {
      'validation.show': 'model.showErrorState',
    }
  }

  surnameField: FormlyFieldConfig = {
          key: 'surname',
          type: 'input',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: '',
            placeholder: 'Your surname',
            required: true
          },
          validation: {
            show: false
          },
          expressionProperties: {
            'validation.show': 'model.showErrorState',
          }
        }

  emailField: FormlyFieldConfig = {
    key: 'email',
    type: 'input',
    className: 'col-md-12',
    defaultValue: '',
    templateOptions: {
      label: '',
      placeholder: 'Your email address',
      required: true
    },
    validation: {
      show: false
    },
    expressionProperties: {
      'validation.show': 'model.showErrorState',
    }
  }

  refContactSubmitButton: FormlyFieldConfig  = {
    hideExpression: !this.isOrganisationExists,
    type: 'button',
    className: 'border',
    templateOptions: {
      text: 'Submit',
      onClick: () => this.getRefContact(),
    },
  }

  refContactPage: FormlyFieldConfig = {
    hideExpression: true,
    fieldGroup: [
      this.firstNameField,
      this.surnameField,
      this.emailField,
      this.refContactSubmitButton,
      this.referringOrganisationContactDetailFormGroup
    ]
  };

  refOrganisationPage: FormlyFieldConfig = {
    fieldGroup: [
      this.referringOrgField,
      this.referringOrganisationDetailFormGroup
    ]
  }

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
            key: 'items',
            type: 'repeat',
            className: 'col-md-6',
            defaultValue: [{}],
            templateOptions: {
              description: 'If your client needs another item, use this button ➜',
              addText: 'Request another item',
              removeText: 'Remove this item',
              required: true,
              min: 1,
              maxItems: 3
            },
            fieldArray: {
              key: 'item',
              type: 'radio',
              className: '',
              templateOptions: {
                label: 'Select the item your client needs.',
                description: 'We currently have no phones or tablets. When we do, we will re-open requests for them.',
                options: [
                  // TODO: find some way to derive these from requestedItems so it's
                  // all defined in one place
                  {value: 'laptops', label: 'Laptop'},
                  // {value: 'phones', label: 'Phone'},
                  {value: 'commsDevices', label: 'SIM card (6 months, 20GB data, unlimited UK calls)' },
                  // {value: 'tablets', label: 'Tablet' },
                  {value: 'desktops', label: 'Desktop computer' },
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
        key: 'hasInternetHome',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client have access to the internet at home?',
          options: [
            {value: 'yes', label: 'Yes'},
            {value: 'no' , label: 'No'},
            {value: 'dk', label: 'Don\'t know'}
          ],
          required: true
        }
      },        
      {
        key: 'hasMobilityNeeds',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client have mobility issues, such as not being able to leave their home, or finding it difficult to do so?',
          options: [
            {value: 'yes', label: 'Yes'},
            {value: 'no' , label: 'No'},
            {value: 'dk', label: 'Don\'t know'}
          ],
          required: true
        }
      },
      {
        key: 'hasTrainingNeeds',
        type: 'radio',
        className: '',
        templateOptions: {
          label: 'Does your client need a Quickstart session or other training in basic use of a computer, phone, or tablet?',
          options: [
            {value: 'yes', label: 'Yes'},
            {value: 'no' , label: 'No'},
            {value: 'dk', label: 'Don\'t know'}
          ],
          required: true
        }
      },
      {
        key: 'attributes.details',
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
        key: 'attributes.clientRef',
        type: 'input',
        className: 'col-md-3',
        defaultValue: '',
        templateOptions: {
          label: 'For your records, enter your client\'s initials or a client reference',
          // TODO: should this be required
          required: false
        }
      }
    ]
  }
 

  fields: Array<FormlyFieldConfig> = [
    {
      className: 'col-md-12',
      template: '<h6 class="m-0 font-weight-bold text-primary">Check your eligibility</h6>'
    },
    {
      key: 'attributes.isIndividual',
      type: 'radio',
      className: 'col-md-12',
      templateOptions: {
        label: 'Is your request for one client?',
        options: [
          {value: true, label: 'Yes'},
          {value: false, label: 'No'}
        ],
        required: true
      },
      validators: {
        mustBeTrue: {
          expression: (c: AbstractControl) => c.value,
          message: (error: any, field: FormlyFieldConfig) => 'This request must be for one client only.'
        }
      }
    },
    {
      hideExpression: 'model.attributes.isIndividual == null || model.attributes.isIndividual == true',
      className: 'col-md-12',
      template: `<div class="border-bottom-info card mb-3 p-3">
<p>This form is for requests for individuals. If your request is for an
organisation rather than an individual, please contact <a href="mailto:
distributions@communitytechaid.org.uk">distributions@communitytechaid.org.uk</a></p>
</div>`
    },
    {
      key: 'attributes.isResident',
      type: 'radio',
      className: '',
      templateOptions: {
        label: 'Does your client live in either Lambeth or Southwark?',
        options: [
          {value: true, label: 'Yes'},
          {value: false , label: 'No'}
        ],
        required: true
      },
      validators: {
        mustBeTrue: {
          expression: (c: AbstractControl) => c.value,
          message: (error: any, field: FormlyFieldConfig) => 'This request must be for a Lambeth or Southwark resident.'
        }
      }
    },
    {
      hideExpression: 'model.attributes.isResident == null || model.attributes.isResident == true',
      className: 'col-md-12',
      template: `<div class="border-bottom-info card mb-3 p-3">
<p>Unfortunately, we can only support people in Lambeth and Southwark currently.</p>
</div>`
    },
    {
      hideExpression: '!model.attributes.isIndividual || !model.attributes.isResident',
      fieldGroup: [
        {
          className: 'col-md-12',
          template: '<h6 class="m-0 font-weight-bold text-primary">About your organisation</h6>'
        },
        this.referringOrgField,
        this.referringOrganisationDetailFormGroup,
        this.refContactPage,  
        this.requestPage
      ]
    }
  ];

  constructor(
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }
  private normalizeData(data: any) {
    data.attributes.request = {'laptops': 0, 
                               'phones': 0, 
                               'commsDevices': 0,
                               'tablets': 0,
                               'desktops': 0};
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
    console.log(data.name)
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
            this.referringOrgLoading = true;}
          ),
          switchMap(term => {
            if (term){
              return from(orgRef.refetch({
            term: term
          })).pipe(
            catchError(() => of([])),
            tap(() => this.referringOrgLoading = false),
            switchMap(res => {
              var data = res['data']['referringOrganisationsConnection']['content'].map(v => {
                return {
                  label: v.name, value: v.id
                };
              });
              
              if (data.length == 0){
                this.hideNewOrganisationField(false);
                data = [{
                  label: 'Use "' + term + '"', value: term, display: term
                }];
              } else{
                this.hideNewOrganisationField(true);
                this.showContactPage();
              }
              return of(data);
            })
          )} return []})
        )
      );

      this.sub = this.referringOrgs$.subscribe(data => {
        this.referringOrgField.templateOptions['items'] = data;
      });

  }

  getRefContact(){
    
    this.apollo.query({
      query: FIND_ORGANISATION_CONTACT,
      variables:{
        name: this.firstNameField.formControl.value,
        surname: this.surnameField.formControl.value,
        email: this.emailField.formControl.value
      }
    }).toPromise().then(res => {
      
      var data = res["data"]["referringOrganisationContact"];
      if (data){
        //create a hidden field for the referringOrganisationContact and use that with data["id"]
      }else {
        this.hideNewContactRefDetailsField(false);
      }
    });

   
  }

  showRequestPage(){
    this.referringOrgField.hideExpression = true;
    this.refOrganisationPage.hideExpression = true;
    this.refContactPage.hideExpression = true;
    this.requestPage.hideExpression = false;
  }

  showOrganisationPage(){
    this.referringOrgField.hideExpression = false;
  }

  showContactPage(){

    
    this.referringOrganisationDetailFormGroup.hideExpression = this.isOrganisationExists;
    
    this.refContactPage.hideExpression = false;

    if (!this.isContactExists){
      this.referringOrganisationContactDetailFormGroup.hideExpression = false;
      this.refContactSubmitButton.hideExpression = true;
    }else{
      this.refContactSubmitButton.hideExpression = false;
    }
  }

  hideNewOrganisationField(hide:boolean){
    this.isOrganisationExists = hide;
    this.isContactExists = hide;
    this.referringOrganisationDetailFormGroup.hideExpression= this.isOrganisationExists;
    this.refContactPage.hideExpression = !this.isOrganisationExists;
  }

  hideNewContactRefDetailsField(hide:boolean){
    this.isContactExists = hide;
    this.referringOrganisationContactDetailFormGroup.hideExpression = this.isContactExists;
  }


  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
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
