import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, ViewChild, ViewEncapsulation, Input, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { DEVICE_REQUEST_STATUS_LABELS, DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP, warnIfFormInvalid, LatestDraw } from '@app/shared/utils';
import { DatePipe } from '@angular/common';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { ActivatedRoute, ParamMap, Params, Router, RouterLink } from '@angular/router';
import { DeliverySlotsComponent } from '../delivery-slots/delivery-slots.component';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';

const QUERY_ENTITY = gql`
query findAllDeviceRequests($page: PaginationInput, $numericterm: Long, $term: String, $filter: DeviceRequestWhereInput!) {
  deviceRequestConnection(
    page: $page,   
    where: {
          AND: [
            $filter,
            {
              OR: [
                { clientRef: { _contains: $term } },
                { id: { _eq: $numericterm } },
                { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } },
                { referringOrganisationContact: { fullName: { _contains: $term } } },
              ]
            }
          ]
        }
  ){
    totalElements
    content{
     id
     status
     clientRef
     collectionDate
     deviceRequestItems {
      phones
      tablets
      laptops
      allInOnes
      desktops
      commsDevices
      other
     }
     kits {
      id
      type
     }
     referringOrganisationContact {
      id
      fullName
      referringOrganisation {
        id
        name
      }
     }
     isPrepped
     collectionMethod
     createdAt
     updatedAt
    }
  }
}
`;

type DndTab = 'requests' | 'slots';

/**
 * Query params this page owns (#282). Anything else in the URL is left alone.
 *   tab=slots            (omitted for the default Device Requests tab)
 *   week=YYYY-MM-DD      Monday of the week (any date is snapped to its Monday)
 *   failed=yes           the Collection/Delivery Failed quick filter
 *   onhold=yes           the On hold quick filter
 *   status=NEW,...       request status enums
 *   sales=no|yes|no,yes|all   (omitted = non-commercial only, the default; `all` = no constraint)
 *   prepped=no|yes       method=collection|delivery       device=LAPTOPS,PHONES,...
 */
const URL_FILTER_PARAMS = ['week', 'failed', 'onhold', 'status', 'sales', 'prepped', 'method', 'device'];
const URL_PARAMS = ['tab', ...URL_FILTER_PARAMS];

interface UrlState {
  tab: DndTab | null;
  /** Any filter param present: the URL then defines the whole filter state and wins over saved filters. */
  hasFilters: boolean;
  model: any;
  week: string | null;
  failed: boolean;
  onHold: boolean;
}

function validDateKey(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  // Snap to that week's Monday.
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dateKey(dt);
}

/** Reads this page's params defensively: unknown params and invalid values are ignored. */
function parseQuery(p: ParamMap): UrlState {
  const csv = (k: string) => (p.get(k) ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const uniq = <T>(a: T[]) => a.filter((v, i) => a.indexOf(v) === i);
  const yesNo = (k: string) => uniq(csv(k).filter(v => v === 'yes' || v === 'no').map(v => v === 'yes'));
  const model: any = {};

  const sales = csv('sales');
  if (sales.includes('all')) {
    model.is_sales = [];
  } else {
    const s = yesNo('sales');
    model.is_sales = s.length ? s : [false];
  }
  const status = uniq(csv('status').filter(s => Object.prototype.hasOwnProperty.call(DEVICE_REQUEST_STATUS, s)));
  if (status.length) model.status = status;
  const prepped = yesNo('prepped');
  if (prepped.length) model.is_prepped = prepped;
  const method = uniq(csv('method').map(m => m.toUpperCase()).filter(m => m === 'COLLECTION' || m === 'DELIVERY'));
  if (method.length) model.collection_method = method;
  const device = uniq(csv('device').filter(d => Object.prototype.hasOwnProperty.call(DEVICE_TYPE_LOOKUP, d)));
  if (device.length) model.device_type = device;

  const tab = p.get('tab');
  return {
    tab: tab === 'slots' || tab === 'requests' ? tab : null,
    hasFilters: URL_FILTER_PARAMS.some(k => p.has(k)),
    model,
    week: validDateKey(p.get('week')),
    failed: p.get('failed') === 'yes',
    onHold: p.get('onhold') === 'yes',
  };
}

/** The inverse of parseQuery: defaults are omitted (null), so a default page has a clean URL. */
function serializeQuery(model: any, week: string | null, failed: boolean, onHold: boolean, tab: DndTab): Record<string, string | null> {
  const list = (v: any[] | undefined, f: (x: any) => string) => (v && v.length ? v.map(f).join(',') : null);
  const yn = (v: any[] | undefined) => list(v ? [...v].sort() : v, x => (x ? 'yes' : 'no'));
  const sales: any[] | undefined = model.is_sales;
  let salesParam: string | null;
  if (!sales || !sales.length) salesParam = 'all';
  else if (sales.length === 1 && sales[0] === false) salesParam = null;
  else salesParam = yn(sales);
  return {
    tab: tab === 'slots' ? 'slots' : null,
    week,
    failed: failed ? 'yes' : null,
    onhold: onHold ? 'yes' : null,
    status: list(model.status, x => String(x)),
    sales: salesParam,
    prepped: yn(model.is_prepped),
    method: list(model.collection_method, x => String(x).toLowerCase()),
    device: list(model.device_type, x => String(x)),
  };
}
const FAILED_STATUSES = ['REQUEST_COLLECTION_DELIVERY_FAILED'];
const ON_HOLD_STATUSES = ['PROCESSING_ON_HOLD'];
/**
 * A week view hides DECLINED / CANCELLED / COLLECTION_DELIVERY_FAILED unless asked for (#42),
 * and ON_HOLD too (staff feedback 2026-11-06: an on-hold request is not going out that week).
 * The Failed and On hold quick buttons bring their statuses back.
 */
const OPEN_STATUSES = [
  'NEW',
  'PROCESSING_EQUALITIES_DATA_COMPLETE',
  'PROCESSING_COLLECTION_DELIVERY_ARRANGED',
  'REQUEST_COMPLETED',
];
type StatusButtonKey = 'failed' | 'onHold';

/** Local 'YYYY-MM-DD'. */
function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Mon 00:00:00.000 to Sun 23:59:59.999 (local) for a Monday key. */
function weekRangeFromKey(key: string): { start: Date; end: Date } {
  const [y, m, d] = key.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 6, 23, 59, 59, 999);
  return { start, end };
}
/**
 * en-GB Monday-Sunday range label: '2–8 Nov', or '30 Nov – 6 Dec' when the week
 * straddles a month boundary.
 */
export function formatWeekLabel(start: Date, end: Date): string {
  const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric' });
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' });
  if (start.getMonth() === end.getMonth()) {
    return `${day(start)}–${day(end)} ${month(end)}`;
  }
  return `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}

@Component({
    selector: 'distributions-and-deliveries-index',
    templateUrl: './distributions-and-deliveries-index.component.html',
    styleUrls: ['./distributions-and-deliveries-index.component.scss'],
    imports: [AppGridDirective_1, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe, DeliverySlotsComponent],
    // OnPush (hygiene 6.5 fan-out, #114). Host-bound state changes via the
    // DataTables ajax callback, applyFilter() (also reached from the week/status
    // quick-filter buttons, which are in the host template and don't strictly
    // need it, but applyFilter marks for check unconditionally to stay correct
    // for the filter-modal path too) and the deliveryBookingVisibility()
    // subscription, which gates the Delivery Slots tab and resolves from an
    // HTTP call outside the host template's event tree.
    //
    // The template also embeds <app-delivery-slots>, which stays on the
    // Default strategy and runs its own independent Apollo queries/mutations.
    // An OnPush ancestor that's never marked dirty skips that whole subtree on
    // the child's own async callbacks — see delivery-slots.component.ts, which
    // now calls cdr.markForCheck() at each of its own async state-assignment
    // sites for exactly this reason (caught by delivery-booking-admin-delete.spec.ts).
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DistributionsAndDeliveriesIndexComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Drops out-of-order ajax responses — see LatestDraw. */
  private readonly draws = new LatestDraw();

  activeTab: DndTab = 'requests';
  /** The tab the URL asked for; 'slots' only takes effect once the feature flag says the tab exists. */
  private desiredTab: DndTab = 'requests';
  deliveryBookingVisible = false;
  private urlSub: Subscription;
  private initialSync = true;

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private featureFlags: FeatureFlagService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.featureFlags.deliveryBookingVisibility().subscribe(state => {
      this.deliveryBookingVisible = state.visible;
      if (state.visible && this.desiredTab === 'slots') this.activeTab = 'slots';
      // Gates the Delivery Slots tab in the host template. This resolves
      // outside the host template's event tree — mark for check or the tab
      // never appears under OnPush.
      this.cdr.markForCheck();
    });
  }
  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  entities = [];

  @Select(CoreWidgetState.query) search$: Observable<string>;

  statusTypes: any = DEVICE_REQUEST_STATUS;

  filter: any = {};
  filterCount = 0;
  /** Total from the last successful load; keeps the pager usable after a failed one. */
  private lastTotal = 0;
  filterModel: any = {is_sales: [false]};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterDeviceTypes = DEVICE_TYPES.filter(t => t.value !== 'BROADBANDHUBS');
  filterFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Status of the request',
            items: DEVICE_REQUEST_STATUS_LABELS,
            multiple: true,
            required: false
          }
        },
        {
          key: 'is_sales',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [false],
          templateOptions: {
            type: 'array',
            label: 'Filter by Commercial Sales?',
            options: [
              {label: 'Non-commercial', value: false },
              {label: 'Commercial', value: true },
            ],
            required: false,
          }
        },
        {
          key: 'device_type',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Device Type?',
            options: this.filterDeviceTypes,
            required: false,
          }
        },
        {
          key: 'is_prepped',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Prepped Status?',
            options: [
              {label: 'Not Prepped', value: false },
              {label: 'Prepped', value: true },
            ],
            required: false,
          }
        },
        {
          key: 'collection_method',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Collection/Delivery?',
            options: [
              {label: 'Collection', value: 'COLLECTION' },
              {label: 'Delivery', value: 'DELIVERY' },
            ],
            required: false,
          }
        },
      ]
    }
  ];

  @Input()
  tableId = 'distributions-and-deliveries-index';

  weekButtons: {key: string, label: string, startDate: Date, endDate: Date, type: 'week'}[] = [];
  statusButtons: {key: StatusButtonKey, label: string, statuses: string[], type: 'status'}[] = [];

  // Quick-filter state is kept apart from the Filter-window state (`filterModel`) and the
  // two are combined only when the query is built in applyFilter() (#280).
  /** Monday of the chosen week as a local 'YYYY-MM-DD' key, or null. */
  quickWeek: string | null = null;
  /** The 'Collection/Delivery Failed' button is on. */
  quickFailed = false;
  /** The 'On hold' button is on. */
  quickOnHold = false;

  /**
   * One short line naming what the current view leaves out by default, or '' when nothing is hidden.
   * Mirrors applyFilter: commercial is hidden while is_sales is exactly [false]; with a week chosen and
   * no Filter-window status, declined / cancelled / failed / on-hold are hidden unless a button adds them.
   */
  get hiddenNote(): string {
    const sales: any[] = this.filterModel?.is_sales ?? [];
    const hidden: string[] = [];
    if (sales.length === 1 && sales[0] === false) hidden.push('commercial');
    if (this.quickWeek && !(this.filterModel?.status?.length)) {
      hidden.push('declined', 'cancelled');
      if (!this.quickFailed) hidden.push('failed');
      if (!this.quickOnHold) hidden.push('on-hold');
    }
    if (!hidden.length) return '';
    const list = hidden.length > 1 ? `${hidden.slice(0, -1).join(', ')} and ${hidden[hidden.length - 1]}` : hidden[0];
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} requests hidden · change in Filter`;
  }

  /** Accessible label for a week button, e.g. 'Week of Mon 2 Nov 2026'. */
  weekTitle(b: { startDate: Date }): string {
    return 'Week of ' + b.startDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');
  }

  get hasQuickFilter(): boolean {
    return !!this.quickWeek || this.quickFailed || this.quickOnHold;
  }

  isStatusButtonActive(key: StatusButtonKey): boolean {
    return key === 'failed' ? this.quickFailed : this.quickOnHold;
  }
  generateWeekButtons() {
    const buttons = [];
    const today = new Date();

    // Find Monday of current week
    const currentDay = today.getDay();
    const diff = currentDay === 0 ? -6 : 1 - currentDay; // Adjust for Sunday (0) or other days
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    // Generate 4 week buttons: current week → 3 weeks ahead (for prepping upcoming deliveries)
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date(monday);
      weekStart.setDate(monday.getDate() + (i * 7));

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const label = formatWeekLabel(weekStart, weekEnd);

      buttons.push({
        key: dateKey(weekStart),
        label,
        startDate: weekStart,
        endDate: weekEnd,
        type: 'week' as const
      });
    }

    return buttons;
  }

  generateStatusButtons() {
    return [
      // {
      //   label: 'Collection/Delivery Arranged',
      //   statuses: ['PROCESSING_COLLECTION_DELIVERY_ARRANGED'],
      //   type: 'status' as const
      // },
      {
        key: 'failed' as const,
        label: 'Collection/Delivery Failed',
        statuses: FAILED_STATUSES,
        type: 'status' as const
      },
      {
        key: 'onHold' as const,
        label: 'On hold',
        statuses: ON_HOLD_STATUSES,
        type: 'status' as const
      }
    ];
  }

  applyWeekFilter(button: {key: string}) {
    this.quickWeek = button.key;
    this.applyFilter(this.filterModel);
  }

  /** The Failed and On hold buttons are toggles: a second click switches just that one off. */
  applyStatusFilter(button: {key: StatusButtonKey}) {
    if (button.key === 'onHold') {
      this.quickOnHold = !this.quickOnHold;
    } else {
      this.quickFailed = !this.quickFailed;
    }
    this.applyFilter(this.filterModel);
  }

  /** Clears only the quick filters; anything chosen in the Filter window stays. */
  clearQuickFilters() {
    this.quickWeek = null;
    this.quickFailed = false;
    this.quickOnHold = false;
    this.applyFilter(this.filterModel);
  }
  setTab(tab: DndTab) {
    this.applyTab(tab);
    this.syncUrl();
  }

  private applyTab(tab: DndTab) {
    this.desiredTab = tab;
    this.activeTab = tab === 'slots' && !this.deliveryBookingVisible ? 'requests' : tab;
  }

  /**
   * Writes the current state into the query string (pushing a history entry, so back/forward
   * walk through filter changes), keeping any params this page does not own. A no-op when the
   * URL already says the same thing, which also stops URL -> state -> URL loops.
   */
  private syncUrl(replace = false) {
    // The first sync only makes the URL describe the restored state, so it must not add a history entry.
    replace = replace || this.initialSync;
    this.initialSync = false;
    const q = serializeQuery(this.filterModel, this.quickWeek, this.quickFailed, this.quickOnHold, this.desiredTab);
    const cur = this.route.snapshot.queryParamMap;
    if (URL_PARAMS.every(k => (q[k] ?? null) === (cur.get(k) ?? null))) return;
    const queryParams: Params = q;
    this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: replace });
  }

  /** Browser back/forward or an edited URL: make the page match it. */
  private onUrlChange(p: ParamMap) {
    const u = parseQuery(p);
    const next = {
      model: u.hasFilters ? u.model : { is_sales: [false] },
      week: u.hasFilters ? u.week : null,
      failed: u.hasFilters && u.failed,
      onHold: u.hasFilters && u.onHold,
    };
    this.applyTab(u.tab ?? 'requests');
    const sameState = JSON.stringify(serializeQuery(next.model, next.week, next.failed, next.onHold, 'requests')) ===
      JSON.stringify(serializeQuery(this.filterModel, this.quickWeek, this.quickFailed, this.quickOnHold, 'requests'));
    if (sameState) {
      this.cdr.markForCheck();
      return;
    }
    this.quickWeek = next.week;
    this.quickFailed = next.failed;
    this.quickOnHold = next.onHold;
    this.applyFilter(next.model);
  }
  // Guards the Filter-modal submit button specifically; applyFilter itself stays
  // unguarded because it's also called internally by the week/status quick-filter
  // buttons and on initial load, which don't go through filterForm.
  applyFilterFromModal(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    this.applyFilter(data);
  }

  /**
   * RESET in the Filter window (#291): back to the page default in one click. That is
   * non-commercial requests only, with the week / Failed / On hold buttons switched off too,
   * the same state as a first visit (and the same idea as the device list's RESET, #76).
   */
  resetFilters() {
    this.quickWeek = null;
    this.quickFailed = false;
    this.quickOnHold = false;
    this.applyFilter({ is_sales: [false] });
  }

  /**
   * Builds the query from the Filter-window model (`data`) combined with the quick-filter
   * state, persists both, and reloads the table.
   *
   * Status scope (staff feedback 2026-11-10: the quick buttons ADD to the list, never replace it):
   *   base  = statuses picked in the Filter window; else, with a week chosen, the open statuses
   *           (#42, which leave out on-hold and failed); else nothing (every status).
   *   + the Failed / On hold buttons' statuses.
   * So week + Failed = that week's open requests plus its failed ones. With no week and no
   * Filter-window status the base is "everything", and a button alone narrows to its status.
   */
  applyFilter(data) {
    const filter: any = {AND: []};
    let count = 0;
    const deviceTypeLookup = DEVICE_TYPE_LOOKUP;

    const picked: string[] = data.status && data.status.length ? [...data.status] : [];
    const quickStatuses = [
      ...(this.quickFailed ? FAILED_STATUSES : []),
      ...(this.quickOnHold ? ON_HOLD_STATUSES : []),
    ];
    // Badge counts what the user chose: Filter-window statuses plus lit buttons, never the
    // implicit open-statuses scope.
    count += picked.length + quickStatuses.filter(s => !picked.includes(s)).length;
    let status: string[] = picked.length ? picked : this.quickWeek ? [...OPEN_STATUSES] : [];
    for (const s of quickStatuses) {
      if (!status.includes(s)) status.push(s);
    }
    if (status.length) {
      filter['status'] = {'_in': status };
    }

    if (data.is_sales && data.is_sales.length) {
      // Commercial + Non-commercial together constrain nothing, so that is no active filter.
      if (data.is_sales.length < 2) count += 1;
      filter['isSales'] = {_in: data.is_sales};
    }

    if (data.device_type && data.device_type.length) {
      // One alternative per type: ticking Laptops + Phones means "wants laptops OR phones" (#291).
      const alternatives = [];

      data.device_type.forEach(devType => {
        if(devType in deviceTypeLookup) {
          count++;
          alternatives.push({ [deviceTypeLookup[devType]]: { _gt: 0 } });
        }
      })
      filter['deviceRequestItems'] = { OR: alternatives };
    }

    if (data.is_prepped && data.is_prepped.length) {
      count += data.is_prepped.length;
      filter['isPrepped'] = {_in: data.is_prepped};
    }

    if (data.collection_method && data.collection_method.length) {
      count += data.collection_method.length;
      filter['collectionMethod'] = {_in: data.collection_method};
    }

    // Collection date range uses AND logic (like kit-index does for createdAt). A range counts as one filter.
    if (this.quickWeek) {
      const { start, end } = weekRangeFromKey(this.quickWeek);
      count += 1;
      filter['AND'].push({collectionDate: {_gte: start.toISOString() }});
      filter['AND'].push({collectionDate: {_lte: end.toISOString() }});
    }

    localStorage.setItem(`distributionsAndDeliveriesFilters-${this.tableId}`, JSON.stringify({
      ...data,
      quick: { week: this.quickWeek, failed: this.quickFailed, onHold: this.quickOnHold },
    }));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    // Called from the filter modal, whose view lives in NgbModal's window —
    // the host's filterCount badge won't repaint under OnPush without this.
    this.cdr.markForCheck();
    this.table.ajax.reload(null, true);
    this.syncUrl();
  }

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  query(evt?: any, filter?: string) {
    if (filter === undefined) {
      filter = this.table.search();
    }

    if (evt) {
      const code = (evt.keyCode ? evt.keyCode : evt.which);
      if (code !== 13) {
        return;
      }
    }

    this.table.search(filter);
    this.table.ajax.reload(null, false);
  }

  ngOnInit() {
    // The URL may ask for the Delivery Slots tab (#282).
    this.applyTab(parseQuery(this.route.snapshot.queryParamMap).tab ?? 'requests');

    // Generate filter buttons
    this.weekButtons = this.generateWeekButtons();
    this.statusButtons = this.generateStatusButtons();

    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    this.dtOptions = {
      pagingType: 'simple_numbers',
      dom:
        '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
        '<\'row\'<\'col-sm-12\'tr>>' +
        '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      pageLength: 10,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [0, 'desc'],
      serverSide: true,
      // No request of DataTables' own on init (#291): it went out before ngAfterViewInit had
      // applied the saved or default filter, so every load fetched twice and the first,
      // unfiltered, answer included commercial rows. applyFilter() makes the first request.
      deferLoading: 0,
      stateSave: true,
      processing: true,
      searching: true,
      language: {
        // Every total this table reports is already filtered, so DataTables always picks this
        // text for an empty page; its default ("No data available in table") reads as "the
        // database is empty" when a search or filter simply matched nothing (#291).
        emptyTable: 'No matching records found',
      },
      // A header click toggles asc/desc; DataTables' default third state is "no sort" (#291).
      columnDefs: [{ targets: '_all', orderSequence: ['asc', 'desc'] }],
      ajax: (params: any, callback) => {
        const drawToken = this.draws.start();
        let sort = params.order.map(o => {
          return {
            key: this.dtOptions.columns[o.column].data,
            value: o.dir
          };
        });
        // Never ask the server for "no order" (#291): paging an unordered result can repeat or
        // skip rows. orderSequence below stops a header click producing this; a table state
        // saved before that could still restore it.
        if (!sort.length) {
          sort = [{ key: 'id', value: 'desc' }];
        }

        const vars = {
          page: {
            sort: sort,
            size: params.length,
            page: Math.round(params.start / params.length),
          },
          term: params['search']['value'],
          numericterm: isNaN(Number(params['search']['value'])) ? -1 : Number(params['search']['value']),
          filter: this.filter
        };

        queryRef.refetch(vars).then(res => {
          if (this.draws.isStale(drawToken)) {
            return;
          }
          let data: any = {};
          if (res.data) {
            data = res['data']['deviceRequestConnection'];
            this.entities = data.content.map(d => {
              const types: Record<string, number> = {};
              const kitIds: Record<string, string[]> = {};
              if (d.kits && d.kits.length) {
                d.kits.forEach(k => {
                  const typeMap: Record<string, string> = { 'SMARTPHONE': 'PHONES', 'OTHER': 'OTHER' };
                  const t = typeMap[k.type] || `${k.type}S`;
                  types[t] = (types[t] || 0) + 1;
                  kitIds[t] = kitIds[t] || [];
                  kitIds[t].push(k.id);
                });
              }
              return { ...d, types, kitIds };
            });
          }
          // The rows are rendered by Angular from `entities`, but this promise
          // resolves outside the host template's event tree — mark for check
          // or the table body never repaints under OnPush.
          this.cdr.markForCheck();

          this.lastTotal = data['totalElements'] || 0;
          callback({
            draw: params.draw,
            recordsTotal: data['totalElements'],
            recordsFiltered: data['totalElements'],
            error: '',
            data: []
          });
        }, err => {
          if (this.draws.isStale(drawToken)) {
            return;
          }
          // The rows on screen belong to the request before this one: clear them rather than
          // leave the previous page showing under the new page number (#291).
          this.entities = [];
          this.cdr.markForCheck();
          // Report the last known total, not zero, so the pager keeps its page links and the
          // user can go back or try again without reloading (#291).
          callback({
            draw: params.draw,
            recordsTotal: this.lastTotal,
            recordsFiltered: this.lastTotal,
            error: err.message,
            data: []
          });

          this.toastr.warning(`
            <small>${err.message}</small>
          `, 'GraphQL Error', {
              enableHtml: true,
              timeOut: 15000,
              disableTimeOut: true
            });
        });
      },
      columns: [
        { data: 'id', width: '15px' },
        // An embedded object has no meaningful order for the API to sort on.
        { data: 'deviceRequestItems', orderable: false },
        { data: 'referringOrganisationContact.fullName' },
        { data: 'referringOrganisationContact.referringOrganisation.name' },
        { data: 'clientRef' },
        { data: 'collectionMethod' },
        { data: 'collectionDate' },
        { data: 'createdAt'},
        { data: 'updatedAt' },
        { data: 'status' },
        { data: null, orderable: false },
      ]
    };
  }

  /**
   * The week buttons are date-derived, so a tab left open across a Monday would keep
   * showing last week's range. Re-derive them when the tab becomes visible again.
   */
  @HostListener('document:visibilitychange')
  refreshWeekButtons() {
    if (document.visibilityState === 'hidden') return;
    const fresh = this.generateWeekButtons();
    if (fresh[0].startDate.getTime() !== this.weekButtons[0]?.startDate.getTime()) {
      this.weekButtons = fresh;
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
    this.urlSub?.unsubscribe();
  }

  /**
   * Reads the saved filters. Old saves stored the week as fixed ISO strings
   * (collectionDateStart/End) inside the model; those are converted to a week key, and a
   * week that is no longer one of the offered buttons is dropped rather than silently
   * re-applied (#280: last month's week used to stick around with nothing lit).
   */
  private readSavedFilters(): { model: any; week: string | null; failed: boolean; onHold: boolean } {
    const fallback = { model: {is_sales: [false]}, week: null, failed: false, onHold: false };
    try {
      const raw = JSON.parse(localStorage.getItem(`distributionsAndDeliveriesFilters-${this.tableId}`));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
      const { quick, collectionDateStart, collectionDateEnd, ...model } = raw;
      let week: string | null = typeof quick?.week === 'string' ? quick.week : null;
      if (!week && typeof collectionDateStart === 'string' && !isNaN(Date.parse(collectionDateStart))) {
        week = dateKey(new Date(collectionDateStart));
      }
      if (week && !this.weekButtons.some(b => b.key === week)) week = null;
      return { model, week, failed: quick?.failed === true, onHold: quick?.onHold === true };
    } catch (_) {
      return fallback;
    }
  }
  ngAfterViewInit() {
    this.grid.dtInstance.then(tbl => {
      this.table = tbl;
      // Filters in the URL win over saved ones (#282): a link is an explicit request.
      const fromUrl = parseQuery(this.route.snapshot.queryParamMap);
      const saved = fromUrl.hasFilters
        ? { model: fromUrl.model, week: fromUrl.week, failed: fromUrl.failed, onHold: fromUrl.onHold }
        : this.readSavedFilters();
      this.filterModel = saved.model;
      this.quickWeek = saved.week;
      this.quickFailed = saved.failed;
      this.quickOnHold = saved.onHold;
      try {
        this.applyFilter(this.filterModel);
        this.filterForm.patchValue(this.filterModel);
      } catch (_) {
      }
      // Back/forward and hand-edited URLs. The first emission is the state just applied.
      this.urlSub = this.route.queryParamMap.pipe(skip(1)).subscribe(p => this.onUrlChange(p));
    });
  }
}
