import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { BoroughAvailabilityService } from '@app/shared/services/borough-availability.service';
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP } from '@app/shared/utils/device-types';

const QUERY = gql`
  query BoroughAvailabilityAdmin {
    boroughGroups {
      id
      name
      boroughs
      status
      maxPerReferee
      availability {
        deviceType
        mode
      }
      updatedAt
    }
    referrerLimitExceptions {
      id
      organisationId
      organisationName
      boroughGroupId
      maxPerReferee
    }
  }
`;

const SAVE = gql`
  mutation SaveBoroughAvailability($data: SaveBoroughAvailabilityInput!) {
    saveBoroughAvailability(data: $data) {
      id
      name
      boroughs
      status
      maxPerReferee
      availability {
        deviceType
        mode
      }
      updatedAt
    }
  }
`;

const SEARCH_ORGANISATIONS = gql`
  query SearchReferringOrganisations($term: String) {
    referringOrganisations(where: { name: { _contains: $term }, archived: { _eq: false } }) {
      content {
        id
        name
      }
    }
  }
`;

export type Mode = 'ON' | 'OFF' | 'AUTO';

/**
 * A device-type column. Derived from the shared DEVICE_TYPES list rather than re-listed here —
 * the handoff is explicit that this screen must not fork a second copy of the device types.
 *
 * The icons are the exception: they live on the device request subpanel and nowhere shareable, so
 * they are mapped here by server key. If a device type is ever added, the column appears
 * automatically and only the icon needs adding.
 */
const ICONS: Record<string, string> = {
  laptops: 'fas fa-laptop',
  phones: 'fas fa-mobile-alt',
  tablets: 'fas fa-tablet-alt',
  allInOnes: 'fas fa-desktop',
  desktops: 'fas fa-desktop',
  commsDevices: 'fas fa-microchip',
  broadbandHubs: 'fas fa-wifi',
  other: 'fas fa-box',
};

export interface DeviceColumn {
  /** The server-side key, e.g. `allInOnes`. This is what crosses GraphQL. */
  key: string;
  label: string;
  icon: string;
}

export interface GroupRow {
  id: string | null;
  name: string;
  boroughs: string[];
  status: string;
  maxPerReferee: number;
  /** Mode per device-type key. Always holds an entry for every column. */
  modes: Record<string, Mode>;
  updatedAt?: string | null;
}

export interface ExceptionRow {
  organisationId: string | null;
  /** What is in the text box — not necessarily a confirmed selection. */
  organisationName: string;
  /** The exact option text that produced `organisationId`, so a re-touch cannot clear it. */
  selectedLabel?: string | null;
  boroughGroupId: string | null;
  maxPerReferee: number;
}

@Component({
  selector: 'app-borough-availability',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './borough-availability.component.html',
  styleUrl: './borough-availability.component.scss',
})
export class BoroughAvailabilityComponent implements OnInit, OnDestroy {
  readonly columns: DeviceColumn[] = DEVICE_TYPES.map((type) => ({
    key: DEVICE_TYPE_LOOKUP[type.value],
    label: type.label,
    icon: ICONS[DEVICE_TYPE_LOOKUP[type.value]] ?? 'fas fa-box',
  }));

  groups: GroupRow[] = [];
  exceptions: ExceptionRow[] = [];
  lastUpdated: string | null = null;

  loading = true;
  saving = false;
  loadError = false;

  /**
   * The pristine server state, serialised. Every "is anything unsaved?" question is answered by
   * comparing against this rather than by incrementing a counter on each edit — a counter drifts
   * the moment someone sets a cell back to what it already was, and then the header claims
   * unsaved changes that do not exist.
   */
  private pristine = '';

  /**
   * Whether a load has actually succeeded.
   *
   * Everything that can write is gated on this. Without it, a failed load left `groups: []`,
   * `exceptions: []` and `pristine: ''` — which do not match, so the form read as dirty and
   * offered an enabled Save. Pressing it would have sent an empty configuration to a mutation
   * that replaces wholesale, deleting every borough group and exception. A transient 500 on a
   * routine page open was one click away from wiping the config.
   */
  private loaded = false;

  /** Which cell's editor row is open. Only ever one, per the design. */
  editing: { groupId: string | null; key: string } | null = null;

  organisationSearch = new Subject<string>();
  organisationResults: { id: string; name: string }[] = [];

  private sub = new Subscription();

  constructor(
    private readonly apollo: Apollo,
    private readonly toastr: ToastrService,
    private readonly availability: BoroughAvailabilityService,
  ) {}

  ngOnInit(): void {
    this.load();

    this.sub.add(
      this.organisationSearch
        .pipe(
          debounceTime(200),
          distinctUntilChanged(),
          switchMap((term) =>
            this.apollo.query<{ referringOrganisations: { content: { id: string; name: string }[] } }>({
              query: SEARCH_ORGANISATIONS,
              variables: { term },
              fetchPolicy: 'network-only',
            }),
          ),
        )
        .subscribe({
          next: ({ data }) => (this.organisationResults = data?.referringOrganisations?.content ?? []),
          error: () => (this.organisationResults = []),
        }),
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  private load(): void {
    this.loading = true;
    this.loadError = false;
    this.loaded = false;
    this.apollo
      .query<{ boroughGroups: any[]; referrerLimitExceptions: any[] }>({
        query: QUERY,
        fetchPolicy: 'network-only',
      })
      .subscribe({
        next: ({ data }) => {
          this.groups = (data?.boroughGroups ?? []).map((group) => ({
            id: String(group.id),
            name: group.name,
            boroughs: [...(group.boroughs ?? [])],
            status: group.status,
            maxPerReferee: group.maxPerReferee,
            modes: this.modesFrom(group.availability ?? []),
            updatedAt: group.updatedAt,
          }));
          this.exceptions = (data?.referrerLimitExceptions ?? []).map((row) => ({
            organisationId: String(row.organisationId),
            organisationName: row.organisationName,
            boroughGroupId: String(row.boroughGroupId),
            maxPerReferee: row.maxPerReferee,
          }));
          this.lastUpdated =
            this.groups.map((g) => g.updatedAt).filter(Boolean).sort().pop() ?? null;
          this.pristine = this.snapshot();
          this.loaded = true;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.loadError = true;
          // Leave `loaded` false so nothing can be saved from a configuration we never read.
          this.groups = [];
          this.exceptions = [];
          this.toastr.error('Could not load the borough availability configuration');
        },
      });
  }

  /** Every column gets an entry, defaulting to OFF — an absent row means "not offered". */
  private modesFrom(availability: { deviceType: string; mode: string }[]): Record<string, Mode> {
    const stored = new Map(availability.map((a) => [a.deviceType, a.mode as Mode]));
    const modes: Record<string, Mode> = {};
    this.columns.forEach((column) => (modes[column.key] = stored.get(column.key) ?? 'OFF'));
    return modes;
  }

  private snapshot(): string {
    return JSON.stringify({ groups: this.groups, exceptions: this.exceptions });
  }

  /**
   * Gated on `loaded`, not merely on `!loading`. See the comment on `loaded` — the difference is
   * a one-click wipe of the entire configuration after a failed read.
   */
  get dirty(): boolean {
    return this.loaded && !this.loading && this.snapshot() !== this.pristine;
  }

  /** Whether Save may be pressed at all. */
  get canSave(): boolean {
    return this.dirty && !this.saving;
  }

  /**
   * How many individual values differ from what the server holds.
   *
   * Counted by comparing against the pristine snapshot rather than tallied as edits happen, so
   * setting a cell back to its original value correctly takes the count back down.
   */
  get unsavedCount(): number {
    if (!this.loaded || !this.pristine) return 0;
    const before = JSON.parse(this.pristine) as { groups: GroupRow[]; exceptions: ExceptionRow[] };
    let count = 0;

    const byId = new Map(before.groups.map((g) => [g.id, g]));
    this.groups.forEach((group) => {
      const original = byId.get(group.id);
      if (!original) {
        count += 1;
        return;
      }
      if (original.maxPerReferee !== group.maxPerReferee) count += 1;
      this.columns.forEach((column) => {
        if (original.modes[column.key] !== group.modes[column.key]) count += 1;
      });
    });

    // Count exception changes field by field rather than by row-count delta, so editing three
    // fields on one row does not report a single change.
    const beforeRows = before.exceptions;
    count += Math.abs(this.exceptions.length - beforeRows.length);
    this.exceptions.slice(0, beforeRows.length).forEach((row, i) => {
      const original = beforeRows[i];
      if (original.organisationId !== row.organisationId) count += 1;
      if (original.boroughGroupId !== row.boroughGroupId) count += 1;
      if (Number(original.maxPerReferee) !== Number(row.maxPerReferee)) count += 1;
    });
    return count;
  }

  // --- cell editing -------------------------------------------------------------------------

  isEditing(group: GroupRow, column: DeviceColumn): boolean {
    return this.editing?.groupId === group.id && this.editing?.key === column.key;
  }

  /** Open this cell's editor, or close it if it is already the open one. */
  toggleEditor(group: GroupRow, column: DeviceColumn): void {
    this.editing = this.isEditing(group, column) ? null : { groupId: group.id, key: column.key };
  }

  closeEditor(): void {
    this.editing = null;
  }

  editingColumn(): DeviceColumn | null {
    return this.columns.find((c) => c.key === this.editing?.key) ?? null;
  }

  setMode(group: GroupRow, key: string, mode: Mode): void {
    group.modes[key] = mode;
  }

  modeOf(group: GroupRow, key: string): Mode {
    return group.modes[key] ?? 'OFF';
  }

  /** Bootstrap contextual class for a cell chip. AUTO is deliberately not "on"-coloured. */
  chipClass(mode: Mode): string {
    if (mode === 'ON') return 'bg-success';
    if (mode === 'AUTO') return 'bg-info';
    return 'bg-secondary';
  }

  chipIcon(mode: Mode): string {
    if (mode === 'ON') return 'fas fa-check';
    if (mode === 'AUTO') return 'fas fa-bolt';
    return 'fas fa-minus';
  }

  /** Whether any cell in this group is set to AUTO — drives the inert-mode warning. */
  hasAuto(group: GroupRow): boolean {
    return this.columns.some((column) => group.modes[column.key] === 'AUTO');
  }

  // --- exceptions ---------------------------------------------------------------------------

  addException(): void {
    this.exceptions = [
      ...this.exceptions,
      {
        organisationId: null,
        organisationName: '',
        boroughGroupId: this.groups[0]?.id ?? null,
        maxPerReferee: this.groups[0]?.maxPerReferee ?? 1,
      },
    ];
  }

  removeException(index: number): void {
    this.exceptions = this.exceptions.filter((_, i) => i !== index);
  }

  /**
   * Options are labelled "Name #id" so the list is unambiguous.
   *
   * Two referring organisations can share a name, and matching on the name alone would silently
   * bind the exception to whichever happened to come back first — an override quietly applied to
   * the wrong organisation, which nothing downstream would flag.
   */
  organisationOption(organisation: { id: string; name: string }): string {
    return `${organisation.name} #${organisation.id}`;
  }

  onOrganisationTyped(row: ExceptionRow, term: string): void {
    row.organisationName = term;

    const byOption = this.organisationResults.find((o) => this.organisationOption(o) === term);
    if (byOption) {
      row.organisationId = byOption.id;
      row.selectedLabel = term;
    } else if (term !== row.selectedLabel) {
      // Only drop the id when the text has actually moved away from what was chosen. Clearing it
      // on every keystroke meant re-touching a row after searching in a different row wiped a
      // valid selection, because the shared results list no longer contained it.
      row.organisationId = null;
      row.selectedLabel = null;
    }

    if (term && term.length >= 3) this.organisationSearch.next(term);
  }

  // --- saving -------------------------------------------------------------------------------

  /**
   * Commit every staged change in one mutation.
   *
   * The server replaces the configuration wholesale, so this sends the complete intended state.
   * That is also why the exceptions are validated here first: a row with no organisation selected
   * would otherwise be silently dropped by the server's own validation along with everything else
   * in the same transaction, and the admin would see a failed save with no obvious cause.
   */
  save(): void {
    // Never send a configuration we did not successfully read: the mutation replaces wholesale,
    // so an empty payload deletes everything.
    if (!this.loaded || this.saving) return;

    const incomplete = this.exceptions.some((e) => !e.organisationId || !e.boroughGroupId);
    if (incomplete) {
      this.toastr.error('Every exception needs an organisation and a borough group');
      return;
    }

    // A cleared number input binds as null, and Number(null) is 0 — which would silently set a
    // borough's referees to zero permitted requests. Reject it rather than interpret it.
    const badLimit = [
      ...this.groups.map((g) => g.maxPerReferee),
      ...this.exceptions.map((e) => e.maxPerReferee),
    ].some((value) => value === null || value === undefined || `${value}` === '' || Number(value) < 0);
    if (badLimit) {
      this.toastr.error('Every request limit needs a number of 0 or more');
      return;
    }

    this.saving = true;
    this.apollo
      .mutate<{ saveBoroughAvailability: any[] }>({
        mutation: SAVE,
        variables: {
          data: {
            groups: this.groups.map((group) => ({
              id: group.id,
              name: group.name,
              boroughs: group.boroughs,
              status: group.status,
              maxPerReferee: Number(group.maxPerReferee),
              availability: this.columns.map((column) => ({
                deviceType: column.key,
                mode: group.modes[column.key],
              })),
            })),
            exceptions: this.exceptions.map((row) => ({
              organisationId: row.organisationId,
              boroughGroupId: row.boroughGroupId,
              maxPerReferee: Number(row.maxPerReferee),
            })),
          },
        },
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.editing = null;
          // The public form caches this per page load, so drop the cache here too — otherwise an
          // admin checking their own change on the request form would keep seeing the old config.
          this.availability.reload();
          this.toastr.success('Borough availability saved');
          this.load();
        },
        error: (err) => {
          this.saving = false;
          // Surface the server's message: its validation errors name the offending borough or
          // device type, which is the only thing that tells an admin what to change.
          this.toastr.error(err?.message ?? 'Could not save the configuration');
        },
      });
  }

  discard(): void {
    if (!window.confirm('Discard all unsaved changes?')) return;
    this.editing = null;
    this.load();
  }

  /** Re-read after a failed load. Distinct from discard(), which throws away staged edits. */
  retry(): void {
    this.load();
  }
}
