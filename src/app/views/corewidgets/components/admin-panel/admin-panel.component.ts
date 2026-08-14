import { Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy } from '@angular/core';
import { Subject, of, Observable, Subscription } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { Router, RouterLink } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { Title } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import { warnIfFormInvalid } from '@app/shared/utils';
import { FeatureFlagsComponent } from '../feature-flags/feature-flags.component';
import { BoroughAvailabilityComponent } from '../borough-availability/borough-availability.component';

const QUERY_CONFIG = gql`
  query adminConfig {
    adminConfig {
      id
      canPublicRequestSIMCard
      canPublicRequestLaptop
      canPublicRequestPhone
      canPublicRequestBroadbandHub
      canPublicRequestTablet
      canPublicRequestDesktop
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
      canPublicRequestDesktop
      createdAt
      updatedAt
    }
  }
`;

@Component({
    selector: 'admin-panel',
    styleUrls: ['admin-panel.component.scss'],
    templateUrl: './admin-panel.component.html',
    imports: [
        RouterLink,
        ReactiveFormsModule,
        FormlyModule,
        DatePipe,
        FeatureFlagsComponent,
        BoroughAvailabilityComponent,
    ]
})
export class AdminPanelComponent implements OnInit, OnDestroy {

  activeTab: 'config' | 'flags' | 'availability' = 'config';

  @ViewChild(BoroughAvailabilityComponent) availabilityTab?: BoroughAvailabilityComponent;

  /**
   * Switch tabs, confirming first if it would throw away staged work.
   *
   * The Borough Availability tab holds edits that are not saved until its own Save is pressed,
   * and it is destroyed when the tab changes. Without this, clicking another tab silently
   * discarded a matrix the admin had spent time on — its own Discard button asks for
   * confirmation, so the far easier path was the destructive one.
   */
  selectTab(tab: 'config' | 'flags' | 'availability'): void {
    if (this.activeTab === 'availability' && tab !== 'availability' && this.availabilityTab?.dirty) {
      const unsaved = this.availabilityTab.unsavedCount;
      const confirmed = window.confirm(
        `You have ${unsaved} unsaved borough availability change${unsaved === 1 ? '' : 's'}.\n\n` +
          'Leaving this tab discards them. Continue?',
      );
      if (!confirmed) return;
    }
    this.activeTab = tab;
  }

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
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  fields: FormlyFieldConfig[] = [
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
                description: 'When enabled, the public can request SIM Cards',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `SIM Card Requests - ${model.canPublicRequestSIMCard ? 'Enabled' : 'Disabled'}`
              }
            },
            {
              key: 'canPublicRequestLaptop',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                description: 'When enabled, the public can request Laptops',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `Laptop Requests - ${model.canPublicRequestLaptop ? 'Enabled' : 'Disabled'}`
              }
            },
            {
              key: 'canPublicRequestPhone',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                description: 'When enabled, the public can request Phones',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `Phone Requests - ${model.canPublicRequestPhone ? 'Enabled' : 'Disabled'}`
              }
            },
            {
              key: 'canPublicRequestBroadbandHub',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                description: 'When enabled, the public can request Broadband Hubs',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `Broadband Hub Requests - ${model.canPublicRequestBroadbandHub ? 'Enabled' : 'Disabled'}`
              }
            },
            {
              key: 'canPublicRequestTablet',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                description: 'When enabled, the public can request Tablets',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `Tablet Requests - ${model.canPublicRequestTablet ? 'Enabled' : 'Disabled'}`
              }
            },
            {
              key: 'canPublicRequestDesktop',
              type: 'checkbox',
              className: 'mb-3',
              templateOptions: {
                description: 'When enabled, the public can request Desktops',
                required: false
              },
              expressionProperties: {
                'templateOptions.label': model =>
                  `Desktop Requests - ${model.canPublicRequestDesktop ? 'Enabled' : 'Disabled'}`
              }
            }
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
    if (warnIfFormInvalid(this.form, this.fields, this.toastr, 'Cannot save configuration')) return;

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
