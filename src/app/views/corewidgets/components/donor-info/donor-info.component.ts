import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
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
import { User, UserState } from '@app/state/user/user.state';
import { KIT_STATUS } from '../kit-info/kit-info.component';

const QUERY_ENTITY = gql`
query findDonor($id: Long) {
  donor(where: {
    id: {
      _eq: $id
    }
  }){
    id
    name
    postCode
    phoneNumber
    email
    referral
    consent
    donorParent {
      id
      name
    }
    kits {
      id
      model
      age
      type
      status
      location
      updatedAt
      createdAt
    }
  }
}
`;

const UPDATE_ENTITY = gql`
mutation updateDonor($data: UpdateDonorInput!) {
  updateDonor(data: $data){
    id
    postCode
    phoneNumber
    email
    name
    referral
    consent
    donorParent {
      id
      name
    }
    kits {
      id
      model
      age
      type
      status
      location
      updatedAt
      createdAt
    }
  }
}
`;

const DELETE_ENTITY = gql`
mutation deleteDonor($id: ID!) {
  deleteDonor(id: $id)
}
`;

const AUTOCOMPLETE_DONOR_PARENTS = gql`
query findAutocompleteDonorParents($term: String) {
  donorParentsConnection(page: {
    size: 50
  }, where: {
    name: { _contains: $term }
  }){
    content  {
      id
      name
    }
  }
}
`;

@Component({
  selector: 'donor-info',
  styleUrls: ['donor-info.scss'],
  templateUrl: './donor-info.html'
})
export class DonorInfoComponent {


  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }
  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  entityName: string;
  entityId: number;
  donorParentId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  ages = {
    0: 'I don\'t know',
    1: 'Less than a year',
    2: '1 - 2 years',
    4: '3 - 4 years',
    5: '5 - 6 years',
    6: 'more than 6 years old'
  };

  donorParents$: Observable<any>;
  donorParentInput$ = new Subject<string>();
  donorParentLoading = false;
  donorParentField: FormlyFieldConfig = {
    key: 'donorParentId',
    type: 'choice',
    className: 'text-left',
    templateOptions: {
      label: 'Parent DOnor',
      description: 'The parent donor for this donor.',
      loading: this.donorParentLoading,
      typeahead: this.donorParentInput$,
      placeholder: 'Assign donor to an associated Parent Donor',
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
          className: 'col-md-6',
          fieldGroup: [

            {
              key: 'name',
              type: 'input',
              className: 'col-md-12 border-left-info card pt-3 mb-3',
              defaultValue: '',
              templateOptions: {
                label: 'Name',
                placeholder: '',
                required: false
              },
              validation: {
                show: false,
              },
              expressionProperties: {
                'validation.show': 'model.showErrorState',
                'templateOptions.disabled': 'formState.disabled',
              },
            },
            {
              key: 'email',
              type: 'input',
              className: 'col-md-6',
              defaultValue: '',
              templateOptions: {
                label: 'Email',
                type: 'email',
                pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
                placeholder: '',
                required: true
              },
              validation: {
                show: false,
              },
              expressionProperties: {
                'validation.show': 'model.showErrorState',
                'templateOptions.disabled': 'formState.disabled',
              },
            },
            {
              key: 'phoneNumber',
              type: 'input',
              className: 'col-md-6',
              defaultValue: '',
              templateOptions: {
                label: 'Phone Number',
                pattern: /\+?[0-9]+/,
                description: 'Required if email is not provided.',
                required: true
              },
              validation: {
                show: false,
              },
              expressionProperties: {
                'validation.show': 'model.showErrorState',
                'templateOptions.disabled': 'formState.disabled',
              },
            }
          ]
        },
        {
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-6',
          // column 2
          fieldGroup: [
            this.donorParentField,
            {
              key: 'postCode',
              type: 'place',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'Address',
                placeholder: '',
                postCode: false,
                required: false
              },
              validation: {
                show: false,
              },
              expressionProperties: {
                'validation.show': 'model.showErrorState',
                'templateOptions.disabled': 'formState.disabled',
              },
            },
            {
              key: 'referral',
              type: 'input',
              className: '',
              defaultValue: '',
              templateOptions: {
                label: 'How did you hear about us?',
                placeholder: '',
                required: false
              },
              validation: {
                show: false,
              },
              expressionProperties: {
                'validation.show': 'model.showErrorState',
                'templateOptions.disabled': 'formState.disabled',
              },
            },
            {
              key: 'consent',
              type: 'radio',
              className: 'col-md-12  border-bottom-info card pt-3 mb-3',
              templateOptions: {
                label: 'We would like to keep in touch with you about our vital work in bridging the digital divide, as well as fundraising appeals and opportunities to support us.',
                placeholder: '',
                required: true,
                options: [
                  { label: 'Yes please, I would like to receive communications via email', value: true },
                  { label: 'No thank you, I would not like to receive communications via email', value: false }
                ]
              }
            }
          ]
        }
      ]
    }
  ];

  kitStatus: any = KIT_STATUS;

  private queryRef = this.apollo
    .watchQuery({
      query: QUERY_ENTITY,
      variables: {}
    });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {
    // Not currently doing any normalization

    if (data.donorParent && data.donorParent.id) {
      data.donorParentId = data.donorParent.id;
      this.donorParentField.templateOptions['items'] = [
        {label: this.donorParentName(data.donorParent), value: data.donorParent.id}
      ];
    }
    return data;
  }

  private fetchData() {
    if (!this.entityId) {
      return;
    }

    this.queryRef.refetch({
      id: this.entityId
    }).then(res => {
      if (res.data && res.data['donor']) {
        const data = res.data['donor'];
        this.model = this.normalizeData(data);
        this.donorParentId = this.model['donorParent']['id'];
        this.entityName = `${this.model['name'] || ''}/${this.model['email'] || ''}/${this.model['phoneNumber'] || ''}`.trim().split('/').filter(f => f.trim().length > 0)[0];
      } else {
        this.model = {};
        this.entityName = 'Not Found!';
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
          term: term
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

    this.sub = this.activatedRoute.params.subscribe(params => {
      this.entityId = +params['donorId'];
      this.fetchData();
    });

    this.sub.add(this.user$.subscribe(user => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:donors']);
    }));

    this.sub.add(this.donorParents$.subscribe(data => {
      this.donorParentField.templateOptions['items'] = data;
    }));
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

  updateEntity(data: any) {
    if (!this.form.valid) {
      this.model['showErrorState'] = true;
      return;
    }
    data.id = this.entityId;
    //data.remove('businessName');
    this.apollo.mutate({
      mutation: UPDATE_ENTITY,
      variables: {
        data
      }
    }).subscribe(res => {
      this.model = this.normalizeData(res.data['updateDonor']);
      this.entityName = `${this.model['name'] || ''} ${this.model['email'] || ''} ${this.model['phoneNumber'] || ''}`.trim().split(' ')[0];
      this.toastr.info(`
      <small>Successfully updated donor ${this.entityName}</small>
      `, 'Updated Donor', {
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
      if (res.data.deleteDonor) {
        this.toastr.info(`
        <small>Successfully deleted donor ${this.entityName}</small>
        `, 'Donor Deleted', {
            enableHtml: true
          });
        this.router.navigate(['/dashboard/donors']);
      }
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Deleting Donor', {
          enableHtml: true
        });
    });
  }
}
