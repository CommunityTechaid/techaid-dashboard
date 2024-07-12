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
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateReferringOrganisation($data: UpdateDeviceRequestInput!) {
    updateDeviceRequest(data: $data) {
      id
      status
      createdAt
      updatedAt
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteReferringOrganisationContact($id: ID!) {
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
          key: 'status',
          type: 'radio',
          className: 'col-md-4 device-request-status',
          defaultValue: 'NEW',
          templateOptions: {
            label: 'Status of the request',
            options: DEVICE_REQUEST_STATUS_LABELS,
            required: true
          }
        },
      ],
    },
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
