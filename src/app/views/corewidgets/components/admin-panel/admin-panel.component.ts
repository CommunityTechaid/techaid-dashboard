import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, Observable, Subscription } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { Router } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { Title } from '@angular/platform-browser';

const QUERY_CONFIG = gql`
  query adminConfig {
    adminConfig {
      id
      canPublicRequestSIMCard
      canPublicRequestLaptop
      canPublicRequestPhone
      canPublicRequestBroadbandHub
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_CONFIG = gql`
  mutation updateAdminConfig($data: UpdateAdminConfigInput!) {
    updateAdminConfig(data: $data) {
      id
      canPublicRequestSIMCard
      canPublicRequestLaptop
      canPublicRequestPhone
      canPublicRequestBroadbandHub
      canPublicRequestTablet
      createdAt
      updatedAt
    }
  }
`;

@Component({
  selector: 'admin-panel',
  styleUrls: ['admin-panel.component.scss'],
  templateUrl: './admin-panel.component.html'
})
export class AdminPanelComponent {

  constructor(
    private modalService: NgbModal,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo,
    private titleService: Title
  ) {
    titleService.setTitle("TaDa - Application Configuration");
  }

  sub: Subscription;
  form: FormGroup = new FormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          // Column 1 - Basic Settings
          fieldGroupClassName: 'd-flex flex-column justify-content-between',
          className: 'col-md-6',
          fieldGroup: [
            {
              key: 'canPublicRequestSIMCard',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                label: 'SIM Card Requests - Enabled',
                description: 'When enabled, the public can request SIM Cards',
                required: false
              }
            },
            {
              key: 'canPublicRequestLaptop',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                label: 'SIM Card Requests - Enabled',
                description: 'When enabled, the public can request SIM Cards',
                required: false
              }
            },
            {
              key: 'canPublicRequestPhone',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                label: 'Phone Requests - Enabled',
                description: 'When enabled, the public can request Phones',
                required: false
              }
            },
            {
              key: 'canPublicRequestBroadbandHub',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                label: 'Broadband Hub Requests - Enabled',
                description: 'When enabled, the public can request Broadband Hubs',
                required: false
              }
            },
            {
              key: 'canPublicRequestTablet',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                label: 'Tablet Requests - Enabled',
                description: 'When enabled, the public can request Tablets',
                required: false
              }
            },
          ]
        }
      ]
    }
  ];

  private queryRef = this.apollo.watchQuery({
    query: QUERY_CONFIG,
    variables: {},
  });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private fetchData() {
    this.queryRef
      .refetch()
      .then(
        (res) => {
          if (res.data && res.data['adminConfig']) {
            this.model = res.data['adminConfig'];
          } else {
            // If no config exists, initialize with defaults
            this.model = {
              appName: '',
              maintenanceMode: false,
              maxUsers: 1000
            };
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
    this.fetchData();

    this.sub = this.user$.subscribe((user) => {
      this.user = user;
      this.options.formState.disabled = !(user && user.authorities && user.authorities['app:admin']);
    });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  updateConfig(data: any) {
    if (!this.form.valid) {
      this.model['showErrorState'] = true;
      return;
    }

    this.apollo
      .mutate({
        mutation: UPDATE_CONFIG,
        variables: {
          data: data,
        },
      })
      .subscribe(
        (res) => {
          this.model = res.data['updateAdminConfig'];
          this.toastr.success(
            `
      <small>Successfully updated application configuration</small>
      `,
            'Configuration Updated',
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

}
