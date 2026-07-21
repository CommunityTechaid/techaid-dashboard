import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subscription } from 'rxjs';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';

// Embedded as the "Feature Flags" tab of the Admin Panel.

const FLAGS_QUERY = gql`
  query featureFlags {
    featureFlags { key enabled updatedAt }
  }
`;

const UPDATE_FLAG = gql`
  mutation updateFeatureFlag($data: UpdateFeatureFlagInput!) {
    updateFeatureFlag(data: $data) { key enabled updatedAt }
  }
`;

// Friendly copy for known flags; unknown keys fall back to the raw key.
const FLAG_LABELS: Record<string, { label: string; description: string }> = {
  'delivery-booking': {
    label: 'Delivery Booking',
    description:
      'Show the public delivery-booking page and the Delivery Slots admin tab on the live/production site. ' +
      'When off, these are visible on UAT only (with a banner) and hidden on production.',
  },
  'update-scanner': {
    label: 'Update Scanner',
    description:
      'Widen access to the bench Update Scanner page. When off, the page and its button on the ' +
      'Devices list are available to staff with the bulk-edit permission. When on, any signed-in ' +
      'staff member can use it — the feature itself stays available either way.',
  },
};

interface FlagRow {
  key: string;
  enabled: boolean;
  updatedAt?: string;
  label: string;
  description: string;
  saving?: boolean;
}

@Component({
  selector: 'app-feature-flags',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './feature-flags.component.html',
  styleUrl: './feature-flags.component.scss',
})
export class FeatureFlagsComponent implements OnInit, OnDestroy {
  flags: FlagRow[] = [];
  loading = true;
  private readonly sub = new Subscription();

  constructor(
    private readonly apollo: Apollo,
    private readonly toastr: ToastrService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.sub.add(
      this.apollo.query<{ featureFlags: FlagRow[] }>({ query: FLAGS_QUERY, fetchPolicy: 'network-only' }).subscribe({
        next: ({ data }) => {
          this.flags = (data.featureFlags || []).map((f) => ({
            ...f,
            ...(FLAG_LABELS[f.key] || { label: f.key, description: '' }),
          }));
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toastr.error('Could not load feature flags');
        },
      }),
    );
  }

  toggle(row: FlagRow): void {
    const next = !row.enabled;
    row.saving = true;
    this.apollo
      .mutate<{ updateFeatureFlag: FlagRow }>({
        mutation: UPDATE_FLAG,
        variables: { data: { key: row.key, enabled: next } },
      })
      .subscribe({
        next: ({ data }) => {
          row.enabled = data!.updateFeatureFlag.enabled;
          row.updatedAt = data!.updateFeatureFlag.updatedAt;
          row.saving = false;
          this.featureFlags.reload();
          this.toastr.success(`${row.label} ${row.enabled ? 'enabled' : 'disabled'}`);
        },
        error: () => {
          row.saving = false;
          this.toastr.error('Could not update the flag');
        },
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
