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

interface FlagCopy {
  label: string;
  description: string;
  /**
   * What OFF means for THIS flag. Load-bearing: "off" does not mean the same thing
   * across these flags, and a bare on/off switch implies it does. Two of them are
   * enforcement guards where off is shadow mode (still evaluated, still logged, but
   * allowed), and one is a scheduled compliance job where off means nothing runs at
   * all. See issue #174.
   */
  offMeaning: string;
  /** Off has consequences beyond hiding a feature — warn, and confirm before disabling. */
  critical?: boolean;
}

// Friendly copy for known flags; unknown keys fall back to the raw key. Descriptions are
// derived from the server-side seeding migrations and guard services, which are the source
// of truth for what each flag actually gates.
const FLAG_LABELS: Record<string, FlagCopy> = {
  'delivery-booking': {
    label: 'Delivery Booking',
    description:
      'Show the public delivery-booking page and the Delivery Slots admin tab on the live/production site. ' +
      'When off, these are visible on UAT only (with a banner) and hidden on production.',
    offMeaning: 'Off = hidden on the live site; visible on UAT only, behind a preview banner.',
  },
  'update-scanner': {
    label: 'Update Scanner',
    description:
      'Widen access to the bench Update Scanner page. When off, the page and its button on the ' +
      'Devices list are available to staff with the bulk-edit permission. When on, any signed-in ' +
      'staff member can use it — the feature itself stays available either way.',
    offMeaning: 'Off = bulk-edit permission holders only. The page works either way.',
  },
  'wipe-cert-enforcement': {
    label: 'Require Wipe Certificate Before Allocation',
    description:
      'Enforce the wipe-certificate check on drive-bearing devices (laptop, desktop, all-in-one). Such a ' +
      'device cannot progress past "Wiped", or be assigned to a device request, unless a wipe certificate ' +
      'reference is recorded or an admin exemption (e.g. no drive) is set. Recycling and repair-return are ' +
      'always allowed either way.',
    offMeaning:
      'Off does NOT mean unchecked — off is shadow mode: every change is still checked and logged, ' +
      'but allowed through. On rejects it with an error.',
  },
  'blocking-flag-enforcement': {
    label: 'Block Allocation of Flagged Devices',
    description:
      'Enforce the rule that a device carrying a problem flag — wipe failed, OS installation failed, needs ' +
      'further investigation, needs a spare part, or locked to a user — cannot be advanced into an ' +
      'allocation or delivered status, nor assigned to a device request. Before this guard existed the rule ' +
      'was only greyed-out options in the device form, so bulk edits and direct API calls bypassed it. ' +
      'Recycling and repair-return are always allowed.',
    offMeaning:
      'Off does NOT mean unchecked — off is shadow mode: every change is still checked and logged, ' +
      'but allowed through. On rejects it with an error.',
  },
  'gdpr-in-app-cleanup': {
    label: 'GDPR Retention Cleanup (scheduled job)',
    description:
      'Run the automatic GDPR data-retention cleanup inside the application — Fridays at 18:00 London, plus ' +
      'a catch-up on start-up if a run was missed while the service was scaled to zero. It replaced the ' +
      'database-side pg_cron job at the 2026-08-12 cutover; that job still exists but is disabled, and is ' +
      'the rollback path.',
    offMeaning:
      'Off = no GDPR retention runs at all. This is a compliance control, not a feature switch — ' +
      'turning it off is a decision, not a toggle.',
    critical: true,
  },
  'tower-hamlets-borough-support': {
    label: 'Tower Hamlets Borough Support',
    description:
      'Placeholder for the upcoming Tower Hamlets borough-support work. Seeded ahead of that work so the ' +
      'toggle exists and matches across UAT and production.',
    offMeaning: 'Nothing reads this flag yet, so neither setting currently has any effect.',
  },
};

// Shown instead of a blank line for a flag with no entry above — a flag added server-side
// before its copy lands here. An empty description reads as a rendering fault.
const UNDESCRIBED: FlagCopy = {
  label: '',
  description: 'No description recorded for this flag yet — see its seeding migration in techaid-server.',
  offMeaning: '',
};

interface FlagRow extends FlagCopy {
  key: string;
  enabled: boolean;
  updatedAt?: string;
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
            ...(FLAG_LABELS[f.key] || { ...UNDESCRIBED, label: f.key }),
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

  /**
   * `event` is needed because the switch is bound one-way with `[checked]`: the browser has
   * already flipped the DOM by the time this runs, and Angular will not put it back when the
   * write does not happen — `row.enabled` never changed, so the binding sees nothing to
   * re-render. Both the cancel path and the error path have to restore it by hand, or the
   * switch shows a state the server does not hold.
   */
  toggle(row: FlagRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const next = !row.enabled;
    // Switching a critical flag OFF stops something that is meant to be running —
    // gdpr-in-app-cleanup halts GDPR retention entirely. Turning one ON is never the
    // dangerous direction, so only the off transition is confirmed.
    if (row.critical && !next && !window.confirm(`${row.label}\n\n${row.offMeaning}\n\nTurn it off anyway?`)) {
      input.checked = row.enabled;
      return;
    }
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
          input.checked = row.enabled;
          this.toastr.error('Could not update the flag');
        },
      });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
