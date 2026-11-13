import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { errorToastText } from '@app/shared/utils/error-toast';
import { MembershipTier, formatMembershipDate, tierLabel } from '@app/shared/membership/membership';

const QUERY_AUDITS = gql`
  query getReferringOrganisationAuditTrail($id: Long!) {
    referringOrganisationAudits(where: $id) {
      type
      revision {
        id
        timestamp
        customUser
      }
      entity {
        name
        website
        phoneNumber
        archived
        membershipTier
        membershipStartDate
        membershipEndDate
      }
    }
  }
`;

interface Snapshot {
  name: string | null;
  website: string | null;
  phoneNumber: string | null;
  archived: boolean | null;
  /** Stored tier and dates; null on revisions written before membership existed. */
  membershipTier: MembershipTier | null;
  membershipStartDate: string | null;
  membershipEndDate: string | null;
}

interface Revision {
  type: 'ADD' | 'MOD' | 'DEL';
  revision: { id: number; timestamp: number; customUser: string | null };
  entity: Snapshot;
}

export interface HistoryRow {
  id: number;
  when: number;
  who: string;
  /** One line per field that differs from the revision before, e.g. "Tier: Free → Tier 1". */
  changes: string[];
  tier: string;
  start: string;
  end: string;
  membershipChanged: boolean;
}

const FIELDS: { key: keyof Snapshot; label: string; membership?: boolean; show: (v: any) => string }[] = [
  { key: 'membershipTier', label: 'Tier', membership: true, show: v => tierLabel(v) },
  { key: 'membershipStartDate', label: 'Membership start', membership: true, show: v => formatMembershipDate(v) || 'none' },
  { key: 'membershipEndDate', label: 'Membership end', membership: true, show: v => formatMembershipDate(v) || 'none' },
  { key: 'name', label: 'Name', show: v => v || 'blank' },
  { key: 'website', label: 'Website', show: v => v || 'blank' },
  { key: 'phoneNumber', label: 'Phone', show: v => v || 'blank' },
  { key: 'archived', label: 'Archived', show: v => (v ? 'yes' : 'no') },
];

/**
 * Turns the server's revisions (oldest first) into table rows (newest first), each saying what
 * changed since the revision before it. Exported for the row logic to be readable on its own.
 */
export function toHistoryRows(revisions: Revision[]): HistoryRow[] {
  return revisions.map((rev, i) => {
    const prev = i > 0 ? revisions[i - 1].entity : null;
    const now = rev.entity;
    let changes: string[];
    let membershipChanged = false;
    if (rev.type === 'DEL') {
      changes = ['Organisation deleted'];
    } else if (rev.type === 'ADD' || !prev) {
      changes = [rev.type === 'ADD' ? 'Organisation created' : 'Earliest recorded revision'];
    } else {
      // Revisions from before membership existed carry no tier: that is not a change to report.
      const comparable = FIELDS.filter(f => !f.membership || prev.membershipTier != null);
      const changed = comparable.filter(f => (prev[f.key] ?? null) !== (now[f.key] ?? null));
      membershipChanged = changed.some(f => f.membership);
      changes = changed.map(f => `${f.label}: ${f.show(prev[f.key])} → ${f.show(now[f.key])}`);
      if (!changes.length) {
        changes = ['Saved with no change to these fields'];
      }
    }
    return {
      id: rev.revision.id,
      when: rev.revision.timestamp,
      who: rev.revision.customUser?.split('|')[1] || 'System',
      changes,
      tier: now.membershipTier ? tierLabel(now.membershipTier) : '—',
      start: formatMembershipDate(now.membershipStartDate) || '—',
      end: formatMembershipDate(now.membershipEndDate) || '—',
      membershipChanged,
    };
  }).reverse();
}

/**
 * History tab on the organisation page: the organisation's audit trail, with the membership tier
 * and dates at each revision (techaid-server#266, organisations only). The server checks the
 * admin permission; the page only hides the tab.
 */
@Component({
  selector: 'referring-organisation-audit',
  templateUrl: './referring-organisation-audit.component.html',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferringOrganisationAuditComponent implements OnChanges {
  @Input() orgId: number;
  /** Changes whenever the organisation is saved (its updatedAt), so the history reloads. */
  @Input() version: string;

  rows: HistoryRow[] | null = null;
  error = '';

  constructor(private apollo: Apollo, private cdr: ChangeDetectorRef) {}

  ngOnChanges() {
    if (!this.orgId) {
      return;
    }
    this.apollo.query<{ referringOrganisationAudits: Revision[] }>({
      query: QUERY_AUDITS,
      variables: { id: this.orgId },
      fetchPolicy: 'network-only',
    }).subscribe({
      next: res => {
        this.rows = toHistoryRows(res.data?.referringOrganisationAudits ?? []);
        this.error = '';
        this.cdr.markForCheck();
      },
      error: err => {
        // Friendly or deliberate text plus the request's ref (#381), never the raw server text.
        this.error = errorToastText(err);
        this.cdr.markForCheck();
      },
    });
  }
}
