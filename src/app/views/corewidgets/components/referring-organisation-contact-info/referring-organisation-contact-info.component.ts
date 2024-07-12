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

const QUERY_ENTITY = gql`
  query findReferringOrganisationContact($id: Long) {
    referringOrganisationContact(where: { id: { _eq: $id } }) {
      id
      fullName
      email
      phoneNumber
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateReferringOrganisation($data: UpdateReferringOrganisationContactInput!) {
    updateReferringOrganisationContact(data: $data) {
      id
      fullName
      email
      phoneNumber
      createdAt
      updatedAt
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteReferringOrganisationContact($id: ID!) {
    deleteReferringOrganisationContact(id: $id)
  }
`;

@Component({
  selector: 'app-referring-organisation-contact-info',
  templateUrl: './referring-organisation-contact-info.component.html',
  styleUrls: ['./referring-organisation-contact-info.component.scss']
})
export class ReferringOrganisationContactInfoComponent {

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
  fullName: string;
  refereeId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  fields: Array<FormlyFieldConfig> = [
    {
      key: 'fullName',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Full Name',
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
          key: 'email',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Email',
            type: 'email',
            pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
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
    if (!this.refereeId) {
      return;
    }

    this.queryRef
      .refetch({
        id: this.refereeId,
      })
      .then(
        (res) => {
          if (res.data && res.data['referringOrganisationContact']) {
            const data = res.data['referringOrganisationContact'];
            this.model = this.normalizeData(data);
            this.fullName = this.model['fullName'];
          } else {
            this.model = {};
            this.fullName = 'Not Found!';
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
      this.refereeId = +params['refereeId'];
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
    data.id = this.refereeId;

    this.apollo
      .mutate({
        mutation: UPDATE_ENTITY,
        variables: {
          data,
        },
      })
      .subscribe(
        (res) => {
          this.model = this.normalizeData(res.data['updateReferringOrganisationContact']);
          this.fullName = this.model['fullName'];
          this.toastr.info(
            `
      <small>Successfully updated referee ${this.fullName}</small>
      `,
            'Updated Referee',
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
        variables: { id: this.refereeId },
      })
      .subscribe(
        (res) => {
          if (res.data.deleteReferringOrganisationContact) {
            this.toastr.info(
              `
        <small>Successfully deleted referee ${this.fullName}</small>
        `,
              'Referee Deleted',
              {
                enableHtml: true,
              }
            );
            this.router.navigate(['/dashboard/referring-organisation-contacts']);
          }
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Error Deleting Referee',
            {
              enableHtml: true,
            }
          );
        }
      );
  }
}
