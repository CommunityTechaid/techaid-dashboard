import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

const QUERY_ENTITY = gql`
  query findReferringOrganisation($id: Long) {
    referringOrganisation(where: { id: { _eq: $id } }) {
      id
      phoneNumber
      name
      website
      archived
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateReferringOrganisation($data: UpdateReferringOrganisationInput!) {
    updateReferringOrganisation(data: $data) {
      id
      phoneNumber
      name
      website
      archived
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteReferringOrganisation($id: ID!) {
    deleteReferringOrganisation(id: $id)
  }
`;

@Component({
  selector: 'app-referring-organisation-info',
  templateUrl: './referring-organisation-info.component.html',
  styleUrls: ['./referring-organisation-info.component.scss']
})
export class ReferringOrganisationInfoComponent {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {}
  sub: Subscription;
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  name: string;
  orgId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  fields: Array<FormlyFieldConfig> = [
    {
      key: 'name',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Name',
        placeholder: '',
        required: true,
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
          key: 'website',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Website',
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
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Phone Number',
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
      ],
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'archived',
          type: 'radio',
          className: 'col-md-6',
          templateOptions: {
            type: 'array',
            label: 'Archived?',
            description: 'Archived organisations are hidden from view',
            options: [
              {label: 'Organisation active and visible', value: false },
              {label: 'Archive and hide this organisation', value: true },
            ],
            required: true,
          }
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
    if (!this.orgId) {
      return;
    }

    this.queryRef
      .refetch({
        id: this.orgId,
      })
      .then(
        (res) => {
          if (res.data && res.data['referringOrganisation']) {
            const data = res.data['referringOrganisation'];
            this.model = this.normalizeData(data);
            this.name = this.model['name'];
          } else {
            this.model = {};
            this.name = 'Not Found!';
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
      this.orgId = +params['orgId'];
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
    data.id = this.orgId;

    this.apollo
      .mutate({
        mutation: UPDATE_ENTITY,
        variables: {
          data,
        },
      })
      .subscribe(
        (res) => {
          this.model = this.normalizeData(res.data['updateReferringOrganisation']);
          this.name = this.model['name'];
          this.toastr.info(
            `
      <small>Successfully updated referring organisation ${this.name}</small>
      `,
            'Updated Referring Organisation',
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
        variables: { id: this.orgId },
      })
      .subscribe(
        (res) => {
          if (res.data.deleteReferringOrganisation) {
            this.toastr.info(
              `
        <small>Successfully deleted referring organisation ${this.name}</small>
        `,
              'Referring Organisation Deleted',
              {
                enableHtml: true,
              }
            );
            this.router.navigate(['/dashboard/referring-organisations']);
          }
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Error Deleting Referring Organisation',
            {
              enableHtml: true,
            }
          );
        }
      );
  }
}
