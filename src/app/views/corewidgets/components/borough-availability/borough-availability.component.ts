import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { ToastrService } from 'ngx-toastr';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, filter, of, switchMap } from 'rxjs';
import { NgSelectComponent } from '@ng-select/ng-select';
import { BoroughAvailabilityService } from '@app/shared/services/borough-availability.service';
import { OFFERABLE_DEVICE_TYPES, DEVICE_TYPE_LOOKUP } from '@app/shared/utils/device-types';

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
    adminConfig {
      id
      canPublicRequestLaptop
      canPublicRequestPhone
      canPublicRequestTablet
      canPublicRequestDesktop
      canPublicRequestSIMCard
      canPublicRequestBroadbandHub
      updatedAt
    }
  }
`;

const UPDATE_GLOBAL = gql`
  mutation UpdateAdminConfig($data: UpdateAdminConfigInput!) {
    updateAdminConfig(data: $data) {
      id
      canPublicRequestLaptop
      canPublicRequestPhone
      canPublicRequestTablet
      canPublicRequestDesktop
      canPublicRequestSIMCard
      canPublicRequestBroadbandHub
      updatedAt
    }
  }
`;

/**
 * The global switch backing each device-type column.
 *
 * These are the six `canPublicRequest*` booleans that used to live on their own Application
 * Configuration tab. They are the ceiling for the whole grid: org-request.ts builds the public
 * device list from them and only then narrows it by borough, so a borough can remove from the
 * offer but never add to it. Keeping the two side by side is the point of merging the tabs — the
 * precedence used to be invisible, and an admin could switch a borough on and see nothing happen.
 *
 * Every offerable device type must appear here. A type with no global switch cannot reach a
 * referrer at all, which is why allInOnes and other were dropped from the grid.
 */
const GLOBAL_KEY_BY_DEVICE_TYPE: Record<string, string> = {
  laptops: 'canPublicRequestLaptop',
  phones: 'canPublicRequestPhone',
  tablets: 'canPublicRequestTablet',
  desktops: 'canPublicRequestDesktop',
  commsDevices: 'canPublicRequestSIMCard',
  broadbandHubs: 'canPublicRequestBroadbandHub',
};

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

/**
 * The organisation lookup behind the exception rows.
 *
 * `referringOrganisationsConnection`, NOT `referringOrganisations`. The latter resolves to a
 * single ReferringOrganisation and has no `content` field, so the query this screen shipped with
 * was rejected by the server every time with "Validation error (FieldUndefined@[referringOrganisations/content])".
 * The lookup therefore never returned a single row against the real API — which is the actual
 * reason an exception could not be saved: with no options to choose from there was no way to
 * record an organisation id, and Save could only ever answer "Every exception needs an
 * organisation and a borough group". Mocked tests could not catch it because they stub the
 * response rather than the schema. Same shape as the referee autocomplete in
 * referring-organisation-contact-info.component.ts, which is the one that has always worked.
 */
const SEARCH_ORGANISATIONS = gql`
  query SearchReferringOrganisations($term: String) {
    referringOrganisationsConnection(page: { size: 50 }, where: { name: { _contains: $term }, archived: { _eq: false } }) {
      content {
        id
        name
      }
    }
  }
`;

export type Mode = 'ON' | 'OFF' | 'AUTO';

/**
 * A device-type column. Derived from the shared OFFERABLE_DEVICE_TYPES list rather than re-listed
 * here — this screen must not fork a second copy of the device types.
 *
 * OFFERABLE_DEVICE_TYPES, not DEVICE_TYPES: a type only reaches a referrer if Application
 * Configuration has a global switch for it, and `allInOnes` and `other` have none. Columns for
 * them were controls that silently did nothing — an admin could set Tower Hamlets to offer
 * all-in-ones and no referrer would ever see one, with nothing on screen explaining why.
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

/**
 * One option in an exception row's organisation picker.
 *
 * The label carries the id ("Name #57") because two referring organisations can share a name.
 * The id is what is bound and saved, so the suffix is only there to let a human tell two
 * identically-named organisations apart in the list.
 */
export interface OrganisationOption {
  id: string;
  label: string;
}

export interface ExceptionRow {
  organisationId: string | null;
  boroughGroupId: string | null;
  maxPerReferee: number;
  /**
   * The options offered by THIS row's picker.
   *
   * Per row rather than one list shared by the whole table: searching in the second row used to
   * replace the options the first row's selection was displayed from, so a valid choice went
   * blank on screen while its id was still staged for save.
   */
  options: OrganisationOption[];
  /** Search terms from this row's picker, wired to the lookup in `wireOrganisationSearch`. */
  search: Subject<string>;
  loading: boolean;
}

@Component({
  selector: 'app-borough-availability',
  standalone: true,
  imports: [FormsModule, NgSelectComponent],
  templateUrl: './borough-availability.component.html',
  styleUrl: './borough-availability.component.scss',
})
export class BoroughAvailabilityComponent implements OnInit, OnDestroy {
  readonly columns: DeviceColumn[] = OFFERABLE_DEVICE_TYPES.map((type) => ({
    key: DEVICE_TYPE_LOOKUP[type.value],
    label: type.label,
    icon: ICONS[DEVICE_TYPE_LOOKUP[type.value]] ?? 'fas fa-box',
  }));

  groups: GroupRow[] = [];
  exceptions: ExceptionRow[] = [];
  lastUpdated: string | null = null;

  /**
   * The global offer, keyed by device type rather than by its `canPublicRequest*` name, so the
   * grid can look it up with the same key it uses for every borough cell.
   */
  globalOffered: Record<string, boolean> = {};

  /** Kept so the update mutation can be addressed to the existing row rather than creating one. */
  private adminConfigId: string | null = null;

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

  private sub = new Subscription();

  constructor(
    private readonly apollo: Apollo,
    private readonly toastr: ToastrService,
    private readonly availability: BoroughAvailabilityService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.exceptions.forEach((row) => row.search.complete());
    this.sub.unsubscribe();
  }

  private load(): void {
    this.loading = true;
    this.loadError = false;
    this.loaded = false;
    // The rows about to be replaced own live picker subjects; completing them tears down their
    // subscriptions rather than leaving a set per load on a screen that reloads after every save.
    this.exceptions.forEach((row) => row.search.complete());
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
          this.exceptions = (data?.referrerLimitExceptions ?? []).map((row) =>
            this.exceptionRow({
              organisationId: String(row.organisationId),
              boroughGroupId: String(row.boroughGroupId),
              maxPerReferee: row.maxPerReferee,
              // Seed the picker with the organisation this row already points at. Without it the
              // select has no option matching its own bound id and renders blank until someone
              // searches — which reads as "no organisation set" on a row that has one.
              // The name can come back null on an exception whose organisation was since archived
              // or renamed away; showing "null #57" would read as corruption. The id alone is
              // still enough to identify the row and to save it unchanged.
              options: [
                {
                  id: String(row.organisationId),
                  label: row.organisationName
                    ? `${row.organisationName} #${row.organisationId}`
                    : `#${row.organisationId}`,
                },
              ],
            }),
          );
          const config = (data as any)?.adminConfig ?? null;
          this.adminConfigId = config?.id != null ? String(config.id) : null;
          this.globalOffered = {};
          this.columns.forEach((column) => {
            const key = GLOBAL_KEY_BY_DEVICE_TYPE[column.key];
            // Absent config means nothing has been configured; treat as not offered rather than
            // assuming a permissive default we never read.
            this.globalOffered[column.key] = key ? Boolean(config?.[key]) : false;
          });

          this.lastUpdated =
            [...this.groups.map((g) => g.updatedAt), config?.updatedAt]
              .filter(Boolean)
              .sort()
              .pop() ?? null;
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
    return JSON.stringify({
      global: this.globalOffered,
      groups: this.groups,
      exceptions: this.exceptionSnapshot(),
    });
  }

  /**
   * Just the three fields that are actually saved.
   *
   * The rows also carry a picker subject and its option list, and neither belongs in a
   * change comparison: the subject is not serialisable at all, and merely searching for an
   * organisation would otherwise rewrite `options` and report the configuration as edited.
   */
  private exceptionSnapshot(): Pick<ExceptionRow, 'organisationId' | 'boroughGroupId' | 'maxPerReferee'>[] {
    return this.exceptions.map((row) => ({
      organisationId: row.organisationId,
      boroughGroupId: row.boroughGroupId,
      maxPerReferee: row.maxPerReferee,
    }));
  }

  /**
   * Whether this device type is switched off for the whole service.
   *
   * Borough cells for such a column are disabled rather than hidden: an admin needs to see that
   * Tower Hamlets *would* offer phones if phones were on globally. Hiding the cell would make the
   * borough look misconfigured when the cause is one row above it.
   */
  isGloballyOff(key: string): boolean {
    return !this.globalOffered[key];
  }

  toggleGlobal(key: string): void {
    if (this.saving || !this.loaded) return;
    this.globalOffered[key] = !this.globalOffered[key];
    // A column that has just been switched off keeps its borough values. They are inert while the
    // global switch is off, and discarding them would lose the borough configuration on a toggle
    // that may well be temporary.
    if (this.editing && this.isGloballyOff(this.editing.key)) this.editing = null;
  }

  private globalChanged(): boolean {
    if (!this.pristine) return false;
    const before = (JSON.parse(this.pristine) as { global?: Record<string, boolean> }).global ?? {};
    return this.columns.some((column) => Boolean(before[column.key]) !== Boolean(this.globalOffered[column.key]));
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
    const before = JSON.parse(this.pristine) as {
      global?: Record<string, boolean>;
      groups: GroupRow[];
      exceptions: Pick<ExceptionRow, 'organisationId' | 'boroughGroupId' | 'maxPerReferee'>[];
    };
    let count = 0;

    const globalBefore = before.global ?? {};
    this.columns.forEach((column) => {
      if (Boolean(globalBefore[column.key]) !== Boolean(this.globalOffered[column.key])) count += 1;
    });

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
      this.exceptionRow({
        organisationId: null,
        boroughGroupId: this.groups[0]?.id ?? null,
        maxPerReferee: this.groups[0]?.maxPerReferee ?? 1,
        options: [],
      }),
    ];
  }

  removeException(index: number): void {
    this.exceptions[index]?.search.complete();
    this.exceptions = this.exceptions.filter((_, i) => i !== index);
  }

  /** Build a row and connect its picker. Every ExceptionRow must come from here. */
  private exceptionRow(
    row: Pick<ExceptionRow, 'organisationId' | 'boroughGroupId' | 'maxPerReferee' | 'options'>,
  ): ExceptionRow {
    const built: ExceptionRow = { ...row, search: new Subject<string>(), loading: false };
    this.wireOrganisationSearch(built);
    return built;
  }

  /**
   * Run one row's typed terms against the organisation lookup.
   *
   * This replaces a native `<datalist>`, which failed in a way worth recording. A datalist offers
   * suggestions but does not require one to be taken, and the row only recorded an organisation
   * when the typed text matched an option character for character — including the " #57" suffix
   * no one would type. An admin who typed the organisation name and pressed Save therefore had
   * `organisationId` null and was told "Every exception needs an organisation and a borough
   * group" while looking at a box with the organisation's name in it. Binding the id from a real
   * selection removes the class of bug rather than the symptom, and is the same control the
   * public booking form already uses for this exact lookup.
   */
  private wireOrganisationSearch(row: ExceptionRow): void {
    this.sub.add(
      row.search
        .pipe(
          // `minTermLength` gates what typing emits, but ng-select's own _clearSearch() pushes a
          // bare null straight into the typeahead subject on select, on close and on clear. Left
          // alone that fires a `_contains: null` search after every pick, whose 50-row answer then
          // replaces this row's options — so reopening a row showed an arbitrary list of
          // organisations rather than what was searched for. Gate the subject itself, since the
          // component cannot rely on who is pushing into it.
          filter((term) => (term ?? '').trim().length >= 3),
          debounceTime(200),
          distinctUntilChanged(),
          switchMap((term) => {
            row.loading = true;
            return this.apollo
              .query<{ referringOrganisationsConnection: { content: { id: string; name: string }[] } }>({
                query: SEARCH_ORGANISATIONS,
                variables: { term },
                fetchPolicy: 'network-only',
              })
              // Swallowed per row: a failed search must leave the row's existing selection and
              // the rest of the table alone, not tear down the whole picker for the page.
              .pipe(catchError(() => of(null)));
          }),
        )
        .subscribe((res) => {
          row.loading = false;
          const found: OrganisationOption[] = (res?.data?.referringOrganisationsConnection?.content ?? []).map(
            (organisation) => ({
              id: String(organisation.id),
              label: `${organisation.name} #${organisation.id}`,
            }),
          );
          row.options = this.keepingSelection(row, found);
        }),
    );
  }

  /**
   * Keep the row's current selection in its option list.
   *
   * Belt and braces rather than a fix for an observed failure: ng-select's own mapSelectedItems
   * already retains a selected item that a later `items` array no longer contains, and every id
   * here originated from this row's own options. This makes the invariant the code depends on —
   * the bound id is always present in the list it is displayed from — true locally, instead of
   * inherited from a third-party implementation detail that could change under a version bump.
   */
  private keepingSelection(row: ExceptionRow, found: OrganisationOption[]): OrganisationOption[] {
    const selected = row.organisationId
      ? row.options.find((option) => option.id === row.organisationId)
      : null;
    if (!selected || found.some((option) => option.id === selected.id)) return found;
    return [selected, ...found];
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

    // Two mutations behind one button, because the global offer and the borough matrix are
    // separate records on the server. Each is sent only if that half actually changed, which is
    // what keeps the usual save a single call — an admin normally touches one or the other.
    //
    // The residual risk is a partial save when both changed and the second call fails. It is not
    // hidden: the error names which half landed, and load() then re-reads the server so the grid
    // shows what is really stored rather than what was attempted. Making this atomic would need a
    // combined server-side mutation, which is not worth it for a screen two people use.
    const globalFirst = this.globalChanged()
      ? this.apollo.mutate({
          mutation: UPDATE_GLOBAL,
          variables: {
            data: this.columns.reduce<Record<string, boolean>>((data, column) => {
              const key = GLOBAL_KEY_BY_DEVICE_TYPE[column.key];
              if (key) data[key] = Boolean(this.globalOffered[column.key]);
              return data;
            }, {}),
          },
        })
      : of(null);

    globalFirst
      .pipe(
        catchError((err) => {
          throw new Error(`The global device settings could not be saved: ${err?.message ?? err}`);
        }),
        switchMap(() => this.saveMatrix()),
      )
      .subscribe({
        next: () => {
          this.saving = false;
          this.editing = null;
          // The public form caches this per page load, so drop the cache here too — otherwise an
          // admin checking their own change on the request form would keep seeing the old config.
          this.availability.reload();
          this.toastr.success('Availability saved');
          this.load();
        },
        error: (err) => {
          this.saving = false;
          this.toastr.error(err?.message ?? 'Could not save the configuration');
          // Re-read so the grid reflects whatever actually landed, including a partial save.
          this.load();
        },
      });
  }

  /** The borough half of the save. Sent only when the matrix itself changed. */
  private saveMatrix() {
    const matrixChanged = (() => {
      if (!this.pristine) return true;
      const before = JSON.parse(this.pristine) as { groups: GroupRow[]; exceptions: unknown[] };
      return (
        JSON.stringify(before.groups) !== JSON.stringify(this.groups) ||
        JSON.stringify(before.exceptions) !== JSON.stringify(this.exceptionSnapshot())
      );
    })();

    if (!matrixChanged) return of(null);

    return this.apollo
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
      .pipe(
        catchError((err) => {
          // Surface the server's message: its validation errors name the offending borough or
          // device type, which is the only thing that tells an admin what to change. Say whether
          // the global half already landed, so a partial save is not a mystery.
          const prefix = this.globalChanged()
            ? 'The global device settings were saved, but the borough matrix was not: '
            : '';
          throw new Error(`${prefix}${err?.message ?? err}`);
        }),
      );
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
