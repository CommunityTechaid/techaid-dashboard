import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { MEMBERSHIP_TIERS, MembershipOverLimitMode } from '@app/shared/membership/membership';

// Embedded as the "Membership" tab of the Admin Panel. Deliberately not gated on the
// membership-support flag: admins set this before switching the flag on.

const CONFIG_QUERY = gql`
  query findMembershipSettings {
    adminConfig { id membershipOverLimitMode membershipGraceRequests updatedAt }
  }
`;

// Every input field is optional server-side (null/absent = unchanged), so send ONLY the two
// membership fields; the canPublicRequest* fields belong to borough-availability.
const UPDATE_CONFIG = gql`
  mutation updateMembershipSettings($data: UpdateAdminConfigInput) {
    updateAdminConfig(data: $data) { id membershipOverLimitMode membershipGraceRequests updatedAt }
  }
`;

interface Config {
  membershipOverLimitMode: MembershipOverLimitMode;
  membershipGraceRequests: number;
}

@Component({
  selector: 'app-membership-settings',
  templateUrl: './membership-settings.component.html',
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [FormsModule],
})
export class MembershipSettingsComponent implements OnInit {
  readonly tiers = MEMBERSHIP_TIERS;
  loading = true;
  unavailable = false;
  saving = false;
  mode: MembershipOverLimitMode = 'BLOCK';
  grace = 0;
  private saved: Config = { membershipOverLimitMode: 'BLOCK', membershipGraceRequests: 0 };

  constructor(
    private apollo: Apollo,
    private toastr: ToastrService,
  ) {}

  ngOnInit(): void {
    this.apollo.query<{ adminConfig: Config }>({ query: CONFIG_QUERY, fetchPolicy: 'network-only' }).subscribe({
      next: ({ data, error }) => {
        if (error || !data?.adminConfig) {
          this.unavailable = true;
        } else {
          this.apply(data.adminConfig);
        }
        this.loading = false;
      },
      error: () => {
        this.unavailable = true;
        this.loading = false;
      },
    });
  }

  get dirty(): boolean {
    return (
      this.mode !== this.saved.membershipOverLimitMode ||
      Number(this.grace) !== this.saved.membershipGraceRequests
    );
  }

  save(): void {
    this.saving = true;
    const data = {
      membershipOverLimitMode: this.mode,
      membershipGraceRequests: Math.max(0, Math.floor(Number(this.grace) || 0)),
    };
    this.apollo.mutate<{ updateAdminConfig: Config }>({ mutation: UPDATE_CONFIG, variables: { data } }).subscribe({
      next: ({ data: res, error }) => {
        this.saving = false;
        if (error || !res?.updateAdminConfig) {
          this.toastr.error('Could not save membership settings');
          return;
        }
        this.apply(res.updateAdminConfig);
        this.toastr.success('Membership settings saved');
      },
      error: () => {
        this.saving = false;
        this.toastr.error('Could not save membership settings');
      },
    });
  }

  // Apollo responses are frozen: copy values into plain fields.
  private apply(c: Config): void {
    this.saved = {
      membershipOverLimitMode: c.membershipOverLimitMode,
      membershipGraceRequests: c.membershipGraceRequests,
    };
    this.mode = this.saved.membershipOverLimitMode;
    this.grace = this.saved.membershipGraceRequests;
  }
}
