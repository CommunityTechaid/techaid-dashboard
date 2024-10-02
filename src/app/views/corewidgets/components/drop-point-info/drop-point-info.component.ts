import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
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
query findDropPoint($id: Long) {
  dropPoint(where: {
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
mutation updateDropPoint($data: UpdateDropPointInput!) {
  updateDropPoint(data: $data){
    id
    postCode
    phoneNumber
    email
    name
    referral
    consent
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
mutation deleteDropPoint($id: ID!) {
  deleteDropPoint(id: $id)
}
`;

@Component({
  selector: 'drop-point-info',
  styleUrls: ['drop-point-info.scss'],
  templateUrl: './drop-point-info.html'
})
export class DropPointInfoComponent {


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

  fields: Array<FormlyFieldConfig> = [
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
      fieldGroupClassName: 'row',
      fieldGroup: [
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
      key: 'postCode',
      type: 'place',
      className: 'col-md-12',
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
      className: 'col-md-12',
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
    return data;
  }

  private fetchData() {
    if (!this.entityId) {
      return;
    }

    this.queryRef.refetch({
      id: this.entityId
    }).then(res => {
      if (res.data && res.data['dropPoint']) {
        const data = res.data['dropPoint'];
        this.model = this.normalizeData(data);
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
    this.sub = this.activatedRoute.params.subscribe(params => {
      this.entityId = +params['dropPointId'];
      this.fetchData();
    });
    this.sub.add(this.user$.subscribe(user => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:dropPoints']);
    }));
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
    this.apollo.mutate({
      mutation: UPDATE_ENTITY,
      variables: {
        data
      }
    }).subscribe(res => {
      this.model = this.normalizeData(res.data['updateDropPoint']);
      this.entityName = `${this.model['name'] || ''} ${this.model['email'] || ''} ${this.model['phoneNumber'] || ''}`.trim().split(' ')[0];
      this.toastr.info(`
      <small>Successfully updated dropPoint ${this.entityName}</small>
      `, 'Updated DropPoint', {
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
      if (res.data.deleteDropPoint) {
        this.toastr.info(`
        <small>Successfully deleted dropPoint ${this.entityName}</small>
        `, 'DropPoint Deleted', {
            enableHtml: true
          });
        this.router.navigate(['/dashboard/dropPoints']);
      }
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Deleting DropPoint', {
          enableHtml: true
        });
    });
  }
}
