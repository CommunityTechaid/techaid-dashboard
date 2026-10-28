import { Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
import { pairwise, startWith } from 'rxjs/operators';
import { NgbModal, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import {
  MEMBERSHIP_FLAG, MEMBERSHIP_SELECTION, MEMBERSHIP_TIERS, formatMembershipDate, membershipPeriodEnd, tierLabel,
} from '@app/shared/membership/membership';
import { MembershipBadgesComponent } from '@app/shared/membership/membership-badges.component';
import { MembershipMeterComponent } from '@app/shared/membership/membership-meter.component';

import { ReferringOrganisationContactComponent } from '../referring-organisation-contact-component/referring-organisation-contact-component.component';
import { DeviceRequestComponent } from '../device-request-component/device-request-component.component';

const queryEntity = (membership: string) => gql`
  query findReferringOrganisation($id: Long) {
    referringOrganisation(where: { id: { _eq: $id } }) {
      id
      phoneNumber
      name
      website
      archived
      createdAt
      updatedAt
      ${membership}
    }
  }
`;

const updateEntity = (membership: string) => gql`
  mutation updateReferringOrganisation($data: UpdateReferringOrganisationInput!) {
    updateReferringOrganisation(data: $data) {
      id
      phoneNumber
      name
      website
      archived
      ${membership}
    }
  }
`;

// Membership fields exist only once techaid-server#311 is deployed, so they are requested
// only while the membership flag is on (see shared/membership/membership.ts).
const ORG_MEMBERSHIP_FIELDS = `membershipTier membershipStartDate membershipEndDate ${MEMBERSHIP_SELECTION} membershipContacts { id fullName }`;
const QUERY_ENTITY = queryEntity('');
const QUERY_ENTITY_MEMBERSHIP = queryEntity(ORG_MEMBERSHIP_FIELDS);
const UPDATE_ENTITY = updateEntity('');
const UPDATE_ENTITY_MEMBERSHIP = updateEntity(ORG_MEMBERSHIP_FIELDS);

const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const MEMBERSHIP_FIELD_GROUP: FormlyFieldConfig = {
  fieldGroupClassName: 'row membership-section',
  fieldGroup: [
    {
      className: 'col-12',
      template: '<h6 class="font-weight-bold text-primary mb-2">Membership</h6>',
    },
    {
      key: 'membershipTier',
      type: 'select',
      className: 'col-md-4',
      templateOptions: {
        label: 'Membership tier',
        description: 'Every organisation starts on the free tier.',
        options: MEMBERSHIP_TIERS.map(t => ({
          value: t.value,
          label: t.value === 'FREE' ? 'Free tier — up to 10 requests a year'
            : t.value === 'TIER_3' ? `${t.label} — 41+ requests a year (${t.fee})`
            : `${t.label} — up to ${t.value === 'TIER_1' ? 20 : 40} requests a year (${t.fee})`,
        })),
        required: true,
        attributes: { 'data-testid': 'org-membership-tier' },
      },
      hooks: {
        // Rule: when staff (not a model load, hence `dirty`) switch FREE -> paid and the start
        // is empty or already in the past, the membership starts today and ends a year on.
        onInit: (field) => {
          field.formControl.valueChanges.pipe(startWith(field.formControl.value), pairwise()).subscribe(([prev, next]) => {
            const m = field.model;
            if (field.formControl.dirty && prev === 'FREE' && next && next !== 'FREE') {
              const today = localToday();
              if (!m.membershipStartDate || m.membershipStartDate < today) {
                m.membershipStartDate = today;
                m.membershipEndDate = membershipPeriodEnd(today);
              }
            }
          });
        },
      },
      expressionProperties: {
        'templateOptions.disabled': (model, formState) => !!formState?.disabled,
      },
    },
    {
      key: 'membershipStartDate',
      type: 'input',
      className: 'col-md-4',
      // Hidden for FREE (the free tier uses the 1 February year). resetOnHide must stay false
      // or Formly wipes the stored dates on the first build (see project_formly_stale_controls).
      hideExpression: 'model.membershipTier === "FREE"',
      resetOnHide: false,
      templateOptions: {
        type: 'date',
        label: 'Membership start date',
        description: 'The day this paid membership starts.',
        required: true,
        attributes: { 'data-testid': 'org-membership-start' },
        // DOM change only (not model loads): re-default the end to start + 1 year - 1 day.
        // It stays editable afterwards.
        change: (field) => {
          const end = membershipPeriodEnd(field.model?.membershipStartDate);
          if (end) {
            field.model.membershipEndDate = end;
            field.form.get('membershipEndDate')?.setValue(end);
          }
        },
      },
      expressionProperties: {
        'templateOptions.disabled': (model, formState) => !!formState?.disabled,
      },
    },
    {
      key: 'membershipEndDate',
      type: 'input',
      className: 'col-md-4',
      hideExpression: 'model.membershipTier === "FREE"',
      resetOnHide: false,
      templateOptions: {
        type: 'date',
        label: 'Membership end date',
        description: 'Defaults to one year after the start date. After this date the organisation goes back to the free tier until it renews.',
        attributes: { 'data-testid': 'org-membership-end' },
      },
      expressionProperties: {
        'templateOptions.disabled': (model, formState) => !!formState?.disabled,
      },
    },
    {
      className: 'col-md-8',
      hideExpression: 'model.membershipTier !== "FREE"',
      template: '<p class="text-muted mb-3">Free tier: uses the standard membership year, 1 February to 31 January.</p>',
    },
  ],
};

const DELETE_ENTITY = gql`
  mutation deleteReferringOrganisation($id: ID!) {
    deleteReferringOrganisation(id: $id)
  }
`;

@Component({
    selector: 'app-referring-organisation-info',
    templateUrl: './referring-organisation-info.component.html',
    styleUrls: ['./referring-organisation-info.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [RouterLink, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, ReactiveFormsModule, FormlyModule, ReferringOrganisationContactComponent, DeviceRequestComponent, NgbNavOutlet, MembershipBadgesComponent, MembershipMeterComponent]
})
export class ReferringOrganisationInfoComponent implements OnInit, OnDestroy {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo,
    private flags: FeatureFlagService
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

  fields: FormlyFieldConfig[] = [
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
        'validation.show': (model) => !!model?.showErrorState,
        'templateOptions.disabled': (model, formState) => !!formState?.disabled,
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
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
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
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
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


  /** Membership flag; null until the flag has loaded. */
  membershipEnabled: boolean | null = null;

  private queryRef = this.apollo.watchQuery({
    query: QUERY_ENTITY,
    variables: {},
  });

  private membershipQueryRef = this.apollo.watchQuery({
    query: QUERY_ENTITY_MEMBERSHIP,
    variables: {},
  });

  get lapsedLabel(): string {
    return tierLabel(this.model?.membership?.lapsedTier);
  }

  get lapsedOn(): string {
    return formatMembershipDate(this.model?.membership?.lapsedOn);
  }

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {
    // Apollo v4 freezes query results; Formly writes into its model, so bind a copy (#219).
    // Every form key is a top-level scalar, so a shallow copy is enough.
    return { ...data };
  }

  private fetchData() {
    if (!this.orgId || this.membershipEnabled === null) {
      return;
    }

    (this.membershipEnabled ? this.membershipQueryRef : this.queryRef)
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
      this.flags.isEnabled(MEMBERSHIP_FLAG).subscribe((enabled) => {
        this.membershipEnabled = enabled;
        if (enabled) {
          // Between Phone and Archived, which is the last group.
          this.fields = [...this.fields.slice(0, -1), MEMBERSHIP_FIELD_GROUP, ...this.fields.slice(-1)];
        }
        this.fetchData();
      })
    );
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
    if (data.membershipStartDate && data.membershipEndDate && data.membershipEndDate < data.membershipStartDate) {
      this.toastr.error('<small>The membership end date cannot be before the start date.</small>', 'Invalid membership dates', { enableHtml: true });
      return;
    }
    if (data.membershipEndDate === '') {
      data.membershipEndDate = null;
    }
    data.id = this.orgId;

    this.apollo
      .mutate({
        mutation: this.membershipEnabled ? UPDATE_ENTITY_MEMBERSHIP : UPDATE_ENTITY,
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
