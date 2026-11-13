import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewChild, viewChild, Input, OnInit, OnDestroy } from '@angular/core';
import { concat, Subject, of, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';
import { KIT_TYPES, warnIfFormInvalid } from '@app/shared/utils';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { FeatureFlagService, UPDATE_SCANNER_FLAG } from '@app/shared/services/feature-flag.service';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective, NativeTableHeaderDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { toastError, toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
  query findAllKits(
    $page: PaginationInput,
    $term: String,
    $where: KitWhereInput!
  ) {
    kitsConnection(
      page: $page,
      where: {
        AND: [
          $where,
          {
            OR: [
              { model: { _contains: $term } },
              { serialNo: { _contains: $term } },
              { id: { _contains: $term } },
            ]
          }
        ]
      }
    ){
      totalElements
      number
      content{
        id
        make
        model
        age
        type
        status
        location
        updatedAt
        createdAt
        lotId
        donor {
          id
          name
          email
          phoneNumber
          donorParent {
            id
            name
            type
          }
        }
        deviceRequest {
          id
          referringOrganisationContact {
            id
            referringOrganisation {
              id
              name
            }
          }
        }
      }
    }
  }
`;

// Lightweight companion to QUERY_ENTITY used only while an ID-list search is
// active: it fetches the whole matched set in one page (id + status only) so we
// can report unmatched IDs and select every match without visiting each page.
const QUERY_ID_LIST_LOOKUP = gql`
  query findKitsByIdList($page: PaginationInput, $where: KitWhereInput!) {
    kitsConnection(page: $page, where: $where) {
      totalElements
      content {
        id
        status
      }
    }
  }
`;

const CREATE_ENTITY = gql`
mutation createKits($data: CreateKitInput!) {
  createKit(data: $data){
    id
    type
    model
  }
}
`;

const BULK_UPDATE_KITS = gql`
mutation updateKits($ids: [ID!]!, $status: KitStatus) {
  updateKits(data: { ids: $ids, status: $status }) {
    id
    status
  }
}
`;

const CREATE_QUICK_ENTITY = gql`
mutation quickCreateKit($data: QuickCreateKitInput!) {
  quickCreateKit(data: $data){
    id
    type
    model
    donor {
      id
    }
  }
}
`;

const AUTOCOMPLETE_DEVICE_REQUESTS = gql`
query findAutocompleteDeviceRequests($term: String, $ids: [Long!]) {
  deviceRequestConnection(page: {
    size: 50
  }, where: {
    OR: [
    { id: { _in: $ids } },
    { id: { _contains: $term } },
    { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } },
    { referringOrganisationContact: { fullName: { _contains: $term } } },
    { referringOrganisationContact: { email: { _contains: $term } } }
    ]
  }){
    content  {
     id
     referringOrganisationContact {
      id
      email
      fullName
      phoneNumber
      referringOrganisation {
        id
        name
      }
     }
    }
  }
}
`;

const FIND_USERS = gql`
  query findUsers($deviceRequestIds: [Long!], $donorParentId: [Long!]) {
    deviceRequests(where: {
      id: { _in: $deviceRequestIds }
    }){
      id
      referringOrganisationContact {
        id
        fullName
        email
        phoneNumber
        referringOrganisation {
          id
          name
        }
      }
    }

    donorParents(where: {
      id: { _in: $donorParentId }
    }){
      id
      name
    }
  }
`;

const AUTOCOMPLETE_DONORS = gql`
query findAutocompleteDonors($term: String) {
  donorsConnection(page: {
    size: 50
  }, where: {
    OR: [
      { name: { _contains: $term } },
      { id: { _contains: $term } },
      { phoneNumber: { _contains: $term } },
      { email: { _contains: $term } }
    ]
  }){
    content  {
     id
     name
     email
     phoneNumber
    }
  }
}
`;

const AUTOCOMPLETE_DONOR_PARENTS = gql`
query findAutocompleteDonorParents($term: String, $id: Long) {
  donorParentsConnection(page: {
    size: 50
  }, where: {
    AND: {
      name: { _contains: $term },
      id: { _eq: $id },
      archived: { _eq: false }
    }
  }){
    content  {
      id
      name
      type
    }
  }
}
`;

const AUTOCOMPLETE_LOTIDS = gql`
query findAutocompleteLotIds($term: String, $ids: [String!]) {
  kitsConnection(page: {
    size: 100
  }, where: {
    OR: [
      { lotId: { _contains: $term } },
      { lotId: { _in: $ids } }
    ]
  }){
    content  {
      lotId
    }
  }
}
`;

@Component({
    selector: 'kit-index',
    styleUrls: ['kit-index.scss'],
    templateUrl: './kit-index.html',
    imports: [RouterLink, NativeTableComponent, NativeTableRowDirective, NativeTableHeaderDirective, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush (hygiene 6.5, fanned out from the donor-index pilot, PR #111).
    // Unlike the pilot, this page also has state assigned from two more async
    // sources that don't roll up into a subsequent table reload, so each gets
    // its own cdr.markForCheck(): the scanner/bulk-edit flag & user
    // subscriptions in ngOnInit, and lookupIdList()'s own promise (a second,
    // independent async chain from the table's own request). See the
    // call sites below for why.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class KitIndexComponent implements OnInit, OnDestroy {
  /** Counts requests so only the newest one writes host state (the shell drops stale rows itself). */
  private requestSeq = 0;

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private featureFlags: FeatureFlagService,
    private cdr: ChangeDetectorRef
  ) {

  }
  readonly grid = viewChild(NativeTableComponent<any>);
  @ViewChild('bulkUpdateModal') bulkUpdateModalTpl: any;
  /**
   * Default order is column 1 (Make) desc. Column 0 holds the id link or the bulk-select checkbox, so it
   * is not sortable and its header renders the select-all checkbox (`ctaHeader` template).
   */
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false, custom: true },
    { title: 'Make', key: 'make' },
    { title: 'Model', key: 'model' },
    { title: 'Donor', key: 'donor' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Type', key: 'type' },
    { title: 'Status', key: 'status' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  /** Rows matching the current filter and search (the last answer), for the select-all warning. */
  total: number;
  selections: Record<string, any> = {};
  selected: any[] = [];
  entities: any[] = [];
  options: FormlyFormOptions = {
    formState: {
      donorParentVisible: false
    }
  };
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};
  ages = {
     0: 'I don\'t know',
     1: 'Less than a year',
     2: '1 - 2 years',
     4: '3 - 4 years',
     5: '5 - 6 years',
     6: 'more than 6 years old'
  };
  public user: User;
  @Select(UserState.user) user$: Observable<User>;
  isDonorParentAdmin = false;
  canBulkEdit = false;
  /**
   * Update Scanner entry button. Same rule as the route guard: the
   * `update-scanner` flag WIDENS access, so `flagOn || canBulkEdit` — never
   * `flagOn && …`, which would hide it from bulk editors in the normal
   * flag-off state. See update-scanner-visible.guard.ts.
   */
  canUseScanner = false;
  private updateScannerFlagOn = false;
  bulkMode = false;
  allPageSelected = false;

  // ID-list search state. Deliberately kept out of `this.filter`: applyFilter()
  // rebuilds that object wholesale and persists it to localStorage, so an ID list
  // parked there would survive a filter change and outlive the search box.
  idListIds: number[] = [];
  idListMatched: { id: any, status: string }[] = [];
  idListMissingIds: number[] = [];
  idListLookupFailed = false;
  idListShowAllMissing = false;
  private idListTerm: string = null;
  readonly idListMissingPreview = 20;

  bulkStatusBreakdown: { status: string, label: string, count: number }[] = [];

  bulkUpdateForm: FormGroup = new FormGroup({});
  bulkUpdateModel: any = {};
  bulkUpdateFields: FormlyFieldConfig[] = [
    {
      key: 'status',
      type: 'choice',
      className: 'col-md-12',
      templateOptions: {
        label: 'New Status',
        items: KIT_STATUS_LABELS,
        multiple: false,
        required: true
      }
    }
  ];

  classes = {
    'LOGISTICS': 'dark',
    'TECHNICIAN': 'info',
    'ORGANISER': 'success'
  };

  statusTypes: any = KIT_STATUS;

  deviceRequests$: Observable<any>;
  deviceRequestInput$ = new Subject<string>();
  deviceRequestLoading = false;
  deviceRequestField: FormlyFieldConfig = {
    key: 'deviceRequestIds',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Assigned Device Request',
      description: 'Filter by assigned device request.',
      loading: this.deviceRequestLoading,
      typeahead: this.deviceRequestInput$,
      multiple: true,
      searchable: true,
      items: [],
      required: false
    },
  };

  donorParents$: Observable<any>;
  donorParentInput$ = new Subject<string>();
  donorParentLoading = false;
  donorParentField: FormlyFieldConfig = {
    key: 'donorParentId',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Parent Donor',
      description: 'The parent donor for this donor.',
      loading: this.donorParentLoading,
      typeahead: this.donorParentInput$,
      placeholder: 'Filter by associated Parent Donor',
      multiple: false,
      searchable: true,
      items: []
    },
    hideExpression: true
  };

  donorParentTypeField: FormlyFieldConfig = {
    key: 'donorParentType',
    type: 'multicheckbox',
    className: 'col-sm-4',
    templateOptions: {
      type: 'array',
      label: 'Parent Donor\'s Type?',
      options: [
        {label: 'Business', value: 'BUSINESS' },
        {label: 'Drop Point', value: 'DROPPOINT' }
      ],
      required: false,
    },
    hideExpression: true
  };

  lotIds$: Observable<any>;
  lotIdInput$ = new Subject<string>();
  lotIdLoading = false;
  lotIdField: FormlyFieldConfig = {
    key: 'lotIds',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Lot ID',
      description: 'Filter by Lot ID.',
      loading: this.lotIdLoading,
      typeahead: this.lotIdInput$,
      multiple: true,
      searchable: true,
      items: [],
      required: false
    },
  };

  filter: any = {};
  filterCount = 0;
  filterModel: any = {archived: [false]};
  filterOptions: FormlyFormOptions = {};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'type',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [],
          templateOptions: {
            label: 'Type of device',
            type: 'array',
            options: KIT_TYPES,
          }
        },
        {
          key: 'archived',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [false],
          templateOptions: {
            type: 'array',
            label: 'Filter by Archived?',
            options: [
              { label: 'Active Devices', value: false },
              { label: 'Archived Devices', value: true },
            ],
            required: false,
          }
        },
        {
          className: 'col-sm-4',
          fieldGroup: [
            {
              key: 'subStatus.lockedToUser',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Locked to user?',
                required: false,
              },
            },
            {
              key: 'subStatus.wipeFailed',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Device wipe failed?',
                required: false,
              },
            },
            {
              key: 'subStatus.installationOfOSFailed',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'OS Installation failed?',
                required: false,
              },
            },
            {
              key: 'subStatus.needsFurtherInvestigation',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Needs further investigation?',
                required: false,
              },
            },
            {
              key: 'subStatus.needsSparePart',
              type: 'checkbox',
              className: '',
              templateOptions: {
                label: 'Needs spare part?',
                required: false,
              },
            }

          ]
        },
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Status of the device',
            items: KIT_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        {
          key: 'statusExclude',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Exclude statuses',
            description: 'Hide devices that have any of these statuses (e.g. exclude Recycled).',
            items: KIT_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        this.deviceRequestField,
        this.donorParentField,
        this.donorParentTypeField,
        this.lotIdField
      ]
    },
    {
      validators: {
        validation: [{ name: 'dateRange', options: { errorPath: 'after' } }],
      },
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'after',
          type: 'date',
          className: 'col-md-6',
          templateOptions: {
            label: 'Devices created on or after?',
            required: false
          }
        },
        {
          key: 'before',
          type: 'date',
          className: 'col-md-6',
          templateOptions: {
            label: 'Devices created on or before?',
            required: false
          }
        },
      ]
    }
  ];



  donors$: Observable<any>;
  donorInput$ = new Subject<string>();
  donorLoading = false;
  donorField: FormlyFieldConfig = {
    key: 'donorId',
    type: 'choice',
    className: 'col-md-12',
    templateOptions: {
      label: 'Donor',
      description: 'The donor this device is currently assigned to.',
      loading: this.donorLoading,
      typeahead: this.donorInput$,
      placeholder: 'Assign device to a Donor',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };

  quickForm: UntypedFormGroup = new UntypedFormGroup({});
  quickFields: FormlyFieldConfig[] = [
    {
      key: 'type',
      type: 'radio',
      className: '',
      defaultValue: 'LAPTOP',
      templateOptions: {
        label: 'Type of device',
        options: KIT_TYPES,
        required: true
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'make',
          type: 'input',
          className: 'col-md-3',
          defaultValue: '',
          templateOptions: {
            label: 'Device Make',
            rows: 2,
            placeholder: '',
            required: false
          }
        },
        {
          key: 'model',
          type: 'input',
          className: 'col-md-9',
          defaultValue: '',
          templateOptions: {
            label: 'Device Model',
            rows: 2,
            placeholder: '',
            required: true
          }
        }
      ]
    },
    this.donorField
  ]

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'kit-index';

  applyFilter(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    const filter = {AND: []};
    let count = 0;

    if (data.type && data.type.length) {
      count = count + data.type.length;
      filter['type'] = {'_in': data.type };
    }

    if (data.status && data.status.length) {
      count = count + data.status.length;
      filter['status'] = {'_in': data.status };
    }

    if (data.statusExclude && data.statusExclude.length) {
      count += data.statusExclude.length;
      data.statusExclude.forEach(s => filter['AND'].push({ status: { _neq: s } }));
    }

    if(data.subStatus) {
      const subStatusItems = { };

      for (const key in data.subStatus) {
        if(data.subStatus[key]) {
          count++;
          subStatusItems[key] = { _in: data.subStatus[key] };
        }
      }

    filter['subStatus'] = subStatusItems;
  }

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    if (data.deviceRequestIds && data.deviceRequestIds.length) {
      count += data.deviceRequestIds.length;
      filter['deviceRequest'] = {id: {_in: data.deviceRequestIds}};
    }

    if (data.lotIds && data.lotIds.length) {
      count += data.lotIds.length;
      filter['lotId'] = {_in: data.lotIds};
    }

    if (data.donorParentId && data.donorParentId.length) {
      count += 1;
      filter['donor'] = {donorParent: {id: {_eq: data.donorParentId}}};
    }

    if (data.donorParentType && data.donorParentType.length) {
      count += data.donorParentType.length;
      filter['donor'] = {donorParent: {type: {_in: data.donorParentType}}};
    }

    if(data.after){
      count += 1;
      filter['AND'].push({createdAt: {_gt: data.after }});
    }

    if(data.before){
      const endDate : Date = data.before;
      endDate.setDate(endDate.getDate() + 1);

      count += 1;
      filter['AND'].push({createdAt: {_lt: endDate }});
    }

    localStorage.setItem(`kitFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    // Called from the filter modal, whose view lives in NgbModal's window —
    // the host's filterCount badge won't repaint under OnPush without this.
    this.cdr.markForCheck();
    // The matched set is filter-dependent (archived especially), so re-check it.
    if (this.idListIds.length) {
      this.lookupIdList();
    }
    // A reload before the shell's ngOnInit is a no-op: ngOnInit restores the saved filter first, so the
    // shell's own first request carries it.
    this.grid()?.reload();
  }

  /** True when the active filter restricts the list to non-archived devices. */
  get archivedExcluded(): boolean {
    const archived = (this.filterModel && this.filterModel.archived) || [];
    return archived.length > 0 && archived.indexOf(true) === -1;
  }

  get idListMissingVisible(): number[] {
    return this.idListShowAllMissing
      ? this.idListMissingIds
      : this.idListMissingIds.slice(0, this.idListMissingPreview);
  }

  /**
   * Recognises a pasted list of device IDs in the search box. Returns null when
   * the term isn't ID-list shaped so the caller falls back to the ordinary
   * free-text search.
   *
   * Separators are commas and/or any whitespace (spaces, tabs, new lines), mixed
   * freely, so a column copied from a spreadsheet works. A term with a comma is a
   * list whatever its tokens look like (bad tokens are reported). A term with only
   * whitespace separators is a list only when it has 2+ tokens and every one is an
   * ID, so ordinary multi-word searches ("dell latitude") stay free-text.
   */
  private parseIdList(term: string): { ids: number[], invalid: string[] } {
    if (!term) {
      return null;
    }
    const hasComma = term.indexOf(',') !== -1;
    const tokens = term.split(/[\s,]+/).filter(t => t.length);
    const idShaped = /^(?:CTA-?)?(\d+)$/i;
    if (!hasComma && (tokens.length < 2 || !tokens.every(t => idShaped.test(t)))) {
      return null;
    }
    const ids: number[] = [];
    const seen = {};
    const invalid: string[] = [];
    tokens.forEach(token => {
      const match = idShaped.exec(token);
      if (!match) {
        invalid.push(token);
        return;
      }
      const id = parseInt(match[1], 10);
      if (!seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return { ids, invalid };
  }

  /**
   * Drops the selection whenever the pasted ID list changes, because the selected
   * devices stop being visible in the table the moment the list they came from goes
   * away — leaving a count on the Bulk Update badge for a set nobody can see.
   */
  private clearSelectionOnIdListChange() {
    const count = this.selected.length;
    if (!count) {
      return;
    }
    this.clearSelection();
    this.allPageSelected = false;
    this.toastr.info(
      `<small>Cleared the <strong>${count}</strong> device(s) you had selected, because they are
      no longer shown.</small>`,
      'Selection cleared',
      { enableHtml: true, timeOut: 6000 });
  }

  /** Re-evaluates ID-list mode when the search term changes. */
  private syncIdListMode(term: string) {
    if (term === this.idListTerm) {
      return;
    }
    const hadIdList = this.idListIds.length > 0;
    this.idListTerm = term;
    this.resetIdListState();

    const parsed = this.parseIdList(term);
    if (!parsed) {
      if (hadIdList) {
        this.clearSelectionOnIdListChange();
      }
      return;
    }
    if (hadIdList || parsed.ids.length) {
      this.clearSelectionOnIdListChange();
    }

    if (parsed.invalid.length) {
      const shown = parsed.invalid.slice(0, 5).join(', ');
      const extra = parsed.invalid.length > 5 ? ` (and ${parsed.invalid.length - 5} more)` : '';
      this.toastr.warning(`
        <small>We couldn't read <strong>${shown}</strong>${extra} as a device ID, so your search was
        run as ordinary text instead. Device IDs look like <strong>1234</strong> or
        <strong>CTA-1234</strong>.</small>`,
        'Not a list of device IDs',
        { enableHtml: true, timeOut: 12000 });
      return;
    }

    if (!parsed.ids.length) {
      return;
    }

    this.idListIds = parsed.ids;
    this.lookupIdList();
  }

  private resetIdListState() {
    this.idListIds = [];
    this.idListMatched = [];
    this.idListMissingIds = [];
    this.idListLookupFailed = false;
    this.idListShowAllMissing = false;
  }

  /** The where-clause the table and the lookup share while an ID list is active. */
  private idListWhere() {
    return { AND: [this.filter, { id: { _in: this.idListIds } }] };
  }

  /**
   * One extra query per ID list: it tells the user which IDs didn't match and
   * backs "select all matched" without paging through the table.
   */
  private lookupIdList() {
    const requested = this.idListIds;
    this.apollo.query({
      query: QUERY_ID_LIST_LOOKUP,
      fetchPolicy: 'network-only',
      variables: {
        page: { size: Math.max(requested.length, 1), page: 0 },
        where: this.idListWhere()
      }
    }).toPromise().then(res => {
      if (this.idListIds !== requested) {
        return; // a newer search superseded this one
      }
      const content = (res && res.data && res.data['kitsConnection']
        && res.data['kitsConnection']['content']) || [];
      // Apollo v4 freezes results — clone rather than reusing the frozen rows,
      // since these objects end up in `selections`.
      this.idListMatched = content.map(k => ({ id: k.id, status: k.status }));
      const found = {};
      this.idListMatched.forEach(k => { found[k.id] = true; });
      this.idListMissingIds = requested.filter(id => !found[id]);
      this.idListLookupFailed = false;
      // The ID-list banner is rendered by Angular from this state, but this
      // promise resolves independently of the DataTables ajax callback's own
      // markForCheck — mark for check or it never repaints under OnPush.
      this.cdr.markForCheck();
    }, () => {
      if (this.idListIds !== requested) {
        return;
      }
      this.idListMatched = [];
      this.idListMissingIds = [];
      this.idListLookupFailed = true;
      this.cdr.markForCheck();
    });
  }

  clearIdListSearch() {
    this.resetIdListState();
    this.clearSelectionOnIdListChange();
    this.idListTerm = '';
    this.grid()?.search('');
  }

  selectAllMatched() {
    if (!this.idListMatched.length) {
      return;
    }
    // Prefer the fully-populated row when the device happens to be on screen.
    const onPage = {};
    this.entities.forEach(e => { onPage[e.id] = e; });
    this.selections = {};
    this.idListMatched.forEach(k => { this.selections[k.id] = onPage[k.id] || k; });
    this.select();
    this.toastr.info(
      `<small>Selected all <strong>${this.idListMatched.length}</strong> matched device(s), including
      those on other pages.</small>`,
      'Selection',
      { enableHtml: true, timeOut: 6000 });
  }

  /**
   * RESET in the Filter window (#76). Formly's `resetModel()` only reverts to the model as it was
   * when the window opened, and `filterForm.reset()` nulls every control, so neither cleared the
   * filters. Set the explicit page default (Active devices only), push it into the form, and
   * re-apply so the list, the badge and the saved localStorage filters all match.
   */
  resetFilterForm() {
    const defaults = { archived: [false] };
    this.filterOptions.resetModel?.({ ...defaults });
    this.applyFilter({ ...defaults });
  }

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
    this.bulkStatusBreakdown = [];
  }

  ngOnInit() {
    // Restore the saved filter before the table makes its first request (the shell starts in its own
    // ngOnInit, after this method), so that request carries it.
    try {
      this.filterModel = JSON.parse(localStorage.getItem(`kitFilters-${this.tableId}`)) || {archived: [false]};
      if (this.filterModel && (this.filterModel.deviceRequestIds || this.filterModel.donorParentId) ) {
        this.apollo
        .query({
          query: FIND_USERS,
          variables: {
            deviceRequestIds: this.filterModel.deviceRequestIds || [],
            donorParentId: this.filterModel.donorParentId || []
          }
        })
        .toPromise()
        .then(res => {
          if (res.data) {
            if (res.data['deviceRequests']) {
              this.deviceRequestField.templateOptions['items'] = res.data['deviceRequests'].map(v => {
                return {label: this.deviceRequestName(v), value: v.id };
              });
            }
            if (res.data['donorParents']) {
              this.donorParentField.templateOptions['items'] = res.data['donorParents'].map(v => {
                return {label: this.donorParentName(v), value: v.id };
              });
            }
          }
        });
      }
      if (this.filterModel && this.filterModel.lotIds && this.filterModel.lotIds.length) {
        this.lotIdField.templateOptions['items'] = this.filterModel.lotIds.map(lotId => {
          return {label: lotId, value: lotId};
        });
      }
    } catch (_) {
      this.filterModel = {archived: [false]};
    }

    try {
      this.applyFilter(this.filterModel);
      this.filterForm.patchValue(this.filterModel);
    } catch (_) {
    }

    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    this.sub.add(
      this.featureFlags.isEnabled(UPDATE_SCANNER_FLAG).subscribe((enabled) => {
        this.updateScannerFlagOn = enabled;
        this.canUseScanner = enabled || this.canBulkEdit;
        // Gates the Update Scanner link in the host template. This resolves
        // outside the host template's event tree — mark for check or the
        // link never appears under OnPush.
        this.cdr.markForCheck();
      })
    );

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        this.isDonorParentAdmin = (user && user.authorities && user.authorities['read:donorParents']);
        this.canBulkEdit = !!(user && user.authorities && user.authorities['app:bulkedit']);
        this.canUseScanner = this.updateScannerFlagOn || this.canBulkEdit;
        this.donorParentField.hide = !this.isDonorParentAdmin;
        this.donorParentTypeField.hide = !this.isDonorParentAdmin;
        this.filterOptions.detectChanges?.(this.filterFields[0]);
        // Gates the Bulk Update toggle and the Update Scanner link in the
        // host template. This resolves outside the host template's event
        // tree — mark for check or those controls never appear under OnPush.
        this.cdr.markForCheck();
      })
    );

    const deviceRequestRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DEVICE_REQUESTS,
      variables: {
      }
    });

    this.deviceRequests$ = concat(
      of([]),
      this.deviceRequestInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.deviceRequestLoading = true),
        switchMap(term => from(deviceRequestRef.refetch({
          term: term,
          ids: this.filterModel.deviceRequestIds || [],
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load device requests for filter');
            return of([]);
          }),
          tap(() => this.deviceRequestLoading = false),
          switchMap(res => {
            const data = res['data']['deviceRequestConnection']['content'].map(v => {
              return {
                label: this.deviceRequestName(v), value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.deviceRequests$.subscribe(data => {
      this.deviceRequestField.templateOptions['items'] = data;
    }));

    const donorRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DONORS,
      variables: {
      }
    });

    this.donors$ = concat(
      of([]),
      this.donorInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.donorLoading = true),
        switchMap(term => from(donorRef.refetch({
          term: term
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load donors for filter');
            return of([]);
          }),
          tap(() => this.donorLoading = false),
          switchMap(res => {
            const data = res['data']['donorsConnection']['content'].map(v => {
              return {
                label: this.donorName(v), value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.donors$.subscribe(data => {
      this.donorField.templateOptions['items'] = data;
    }));

    const donorParentRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_DONOR_PARENTS,
      variables: {
      }
    });

    this.donorParents$ = concat(
      of([]),
      this.donorParentInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.donorParentLoading = true),
        switchMap(term => from(donorParentRef.refetch({
          term: term,
          id: this.filterModel.donorParentId || null
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load donor parents for filter');
            return of([]);
          }),
          tap(() => this.donorParentLoading = false),
          switchMap(res => {
            const data = res['data']['donorParentsConnection']['content'].map(v => {
              return {
                label: `${this.donorParentName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.donorParents$.subscribe(data => {
      this.donorParentField.templateOptions['items'] = data;
    }));

    const lotIdRef = this.apollo
    .watchQuery({
      query: AUTOCOMPLETE_LOTIDS,
      variables: {
      }
    });

    this.lotIds$ = concat(
      of([]),
      this.lotIdInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.lotIdLoading = true),
        switchMap(term => from(lotIdRef.refetch({
          term: term,
          ids: this.filterModel.lotIds || [],
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load lot IDs for filter');
            return of([]);
          }),
          tap(() => this.lotIdLoading = false),
          switchMap(res => {
            const data = [...new Set(
              res['data']['kitsConnection']['content']
                .map((v: any) => v.lotId as string)
                .filter((lotId: string) => lotId && lotId.trim().length > 0)
            )].map(lotId => ({
              label: lotId,
              value: lotId
            }));
            return of(data);
          })
        ))
      )
    );

    this.sub.add(this.lotIds$.subscribe(data => {
      this.lotIdField.templateOptions['items'] = data;
    }));

    this.source = async (q) => {
      const seq = ++this.requestSeq;
      const term = q.term || '';
      this.syncIdListMode(term);
      const idListActive = this.idListIds.length > 0;

      const vars = {
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        where: idListActive ? this.idListWhere() : this.filter,
        term: idListActive ? '' : term
      };

      let res: any;
      try {
        res = await queryRef.refetch(vars);
      } catch (err) {
        if (seq === this.requestSeq) {
          // The rows on screen belong to the request before this one.
          this.entities = [];
          this.cdr.markForCheck();
        }
        throw err;
      }
      const data: any = res.data?.['kitsConnection'];
      const rows = data ? data.content.map(d => ({
        ...d,
        donorName: d.donor ? this.donorName(d.donor) : undefined
      })) : [];
      if (seq === this.requestSeq) {
        this.total = data ? data['totalElements'] : 0;
        this.entities = rows;
        this.allPageSelected = rows.length > 0 && rows.every(e => !!this.selections[e.id]);
        // Rows paint from the shell's own signals, but the select-all checkbox and the partial-selection
        // warning read host state set here, outside the host template's event tree.
        this.cdr.markForCheck();
      }
      return { rows, total: data ? data['totalElements'] : 0 };
    };
  }

  onLoadError(err: any) {
    toastWarning(this.toastr, err, 'GraphQL Error', { timeOut: 15000, disableTimeOut: true });
  }

  deviceRequestName(data) {
    return `${data.referringOrganisationContact.referringOrganisation.name || ''}||${data.id || ''}||${data.referringOrganisationContact.email || ''}||${data.referringOrganisationContact.phoneNumber || ''}`
      .split('||')
      .filter((f) => f.trim().length)
      .join(' / ')
      .trim();
  }

  donorName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  donorParentName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  quickCreateEntity(data:any){
    if (warnIfFormInvalid(this.quickForm, this.quickFields, this.toastr)) return;

    this.apollo.mutate({
      mutation: CREATE_QUICK_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.grid()?.reload();
       this.toastr.info(`
        <small>Successfully created device</small>
        `, '', {
            enableHtml: true
          });
    }, err => {
      toastError(this.toastr, err, 'Create Device Error', { timeOut: 15000 });
    });
  }

  select(row?: any) {
    if (row) {
      if (this.selections[row.id]) {
        delete this.selections[row.id];
      } else {
        this.selections[row.id] = row;
      }
    }

    this.selected = [];
    for (const k in this.selections) {
      this.selected.push(this.selections[k]);
    }
    this.allPageSelected = this.entities.length > 0 && this.entities.every(e => !!this.selections[e.id]);
  }

  onRowClick(row: any) {
    if (this.bulkMode) {
      this.select(row);
    }
  }

  onBulkLabelClick() {
    if (!this.bulkMode) return;
    this.toggleBulkMode();
  }

  onBulkButtonClick(event: MouseEvent) {
    if (this.selected.length === 0) return; // bubble to label → toggles off
    event.stopPropagation();
    this.bulkUpdateModel = {};
    this.bulkUpdateForm.reset();
    this.bulkStatusBreakdown = this.tallyStatuses(this.selected);
    this.modalService.open(this.bulkUpdateModalTpl, { centered: true, size: 'lg' });
  }

  /** Every selected row already carries `status`, so no extra query is needed. */
  private tallyStatuses(rows: any[]): { status: string, label: string, count: number }[] {
    const counts = {};
    rows.forEach(r => {
      const status = r && r.status ? r.status : 'UNKNOWN';
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.keys(counts)
      .map(status => ({ status, label: this.statusTypes[status] || status, count: counts[status] }))
      .sort((a, b) => b.count - a.count);
  }

  toggleBulkMode() {
    this.bulkMode = !this.bulkMode;
    if (!this.bulkMode) {
      this.clearSelection();
      this.allPageSelected = false;
    }
  }

  toggleSelectAll() {
    if (this.allPageSelected) {
      this.clearSelection();
      this.allPageSelected = false;
    } else {
      this.selections = {};
      this.entities.forEach(e => { this.selections[e.id] = e; });
      this.selected = [...this.entities];
      this.allPageSelected = true;
      if (this.total > this.entities.length) {
        this.toastr.warning(
          `<small>Only the <strong>${this.entities.length}</strong> devices on this page are selected.
          The full result set contains <strong>${this.total}</strong> devices.
          Navigate to each page and repeat to include all results.</small>`,
          'Partial Selection',
          { enableHtml: true, timeOut: 8000 }
        );
      }
    }
  }

  bulkUpdate(data: any, close: () => void) {
    const ids = this.selected.map(s => s.id);
    if (!ids.length) {
      this.toastr.warning('<small>No devices selected.</small>', '', { enableHtml: true });
      return;
    }
    this.apollo.mutate({
      mutation: BULK_UPDATE_KITS,
      variables: { ids, status: data.status }
    }).subscribe(() => {
      this.toastr.info(`<small>Successfully updated ${ids.length} device(s)</small>`, 'Bulk Update', { enableHtml: true });
      this.clearSelection();
      this.allPageSelected = false;
      // The selection state is host-template state written from an Apollo callback; don't rely on the
      // reload's own markForCheck to repaint it (#115).
      this.cdr.markForCheck();
      this.grid()?.reload();
      close();
    }, (err: any) => {
      toastError(this.toastr, err, 'Bulk Update Error', { timeOut: 15000 });
    });
  }
}
