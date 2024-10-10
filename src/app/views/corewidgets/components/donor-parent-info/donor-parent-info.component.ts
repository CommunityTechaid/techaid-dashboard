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
query findDonorParent($id: Long) {
  donorParent(where: {
    id: {
      _eq: $id
    }
  }){
    id
    name
    address
    website
    type
    donorCount
    donors {
      id
      name
      updatedAt
      createdAt
    }
  }
}
`;

const UPDATE_ENTITY = gql`
mutation updateDonorParent($data: UpdateDonorParentInput!) {
  updateDonorParent(data: $data){
    id
    name
    address
    website
    type
    donors {
      id
      name
      updatedAt
      createdAt
    }
  }
}
`;

const DELETE_ENTITY = gql`
mutation deleteDonorParent($id: ID!) {
  deleteDonorParent(id: $id)
}
`;

@Component({
  selector: 'donor-parent-info',
  styleUrls: ['donor-parent-info.scss'],
  templateUrl: './donor-parent-info.html'
})
export class DonorParentInfoComponent {


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

  fields: Array<FormlyFieldConfig> = [
    {
      key: 'type',
      type: 'radio',
      className: 'col-md-12  border-bottom-info card pt-3 mb-3',
      templateOptions: {
        label: 'Type',
        placeholder: '',
        required: true,
        options: [
          { label: 'Business', value: 'BUSINESS' },
          { label: 'Drop Point', value: 'DROPPOINT' },
        ]
      }
    },
    {
      key: 'name',
      type: 'input',
      className: 'col-md-12 border-left-info card pt-3 mb-3',
      defaultValue: '',
      templateOptions: {
        label: 'Name',
        placeholder: '',
        required: true
      }
    },
    {
      key: 'address',
      type: 'place',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Address',
        placeholder: '',
        postCode: false,
        required: true
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'website',
          type: 'input',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Website',
            pattern: /^(https?:\/\/)?([\w\d-_]+)\.([\w\d-_\.]+)\/?\??([^#\n\r]*)?#?([^\n\r]*)/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.website.length'
          }
        }
      ]
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
    return data;
  }

  private fetchData() {
    if (!this.entityId) {
      return;
    }

    this.queryRef.refetch({
      id: this.entityId
    }).then(res => {
      if (res.data && res.data['donorParent']) {
        const data = res.data['donorParent'];
        this.model = this.normalizeData(data);
        this.entityName = `${this.model['name'] || ''}/${this.model['website'] || ''}`.trim().split('/').filter(f => f.trim().length > 0)[0];
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
      this.entityId = +params['donorParentId'];
      this.fetchData();
    });
    this.sub.add(this.user$.subscribe(user => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:donorParents']);
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
      this.model = this.normalizeData(res.data['updateDonorParent']);
      this.entityName = `${this.model['name'] || ''} ${this.model['email'] || ''} ${this.model['phoneNumber'] || ''}`.trim().split(' ')[0];
      this.toastr.info(`
      <small>Successfully updated parent donor ${this.entityName}</small>
      `, 'Updated DonorParent', {
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
      if (res.data.deleteDonorParent) {
        this.toastr.info(`
        <small>Successfully deleted parent donor ${this.entityName}</small>
        `, 'DonorParent Deleted', {
            enableHtml: true
          });
        this.router.navigate(['/dashboard/donorParents']);
      }
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Error Deleting DonorParent', {
          enableHtml: true
        });
    });
  }
}
