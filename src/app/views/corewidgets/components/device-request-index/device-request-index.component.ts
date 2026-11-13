import { ChangeDetectionStrategy, ChangeDetectorRef, Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subscription, from, Subject, concat, of, firstValueFrom } from 'rxjs';
import { NgbModal, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { DEVICE_REQUEST_STATUS_LABELS, DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP, ALL_BOROUGHS } from '@app/shared/utils';
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { MEMBERSHIP_FLAG, MEMBERSHIP_SELECTION } from '@app/shared/membership/membership';
import { MembershipBadgesComponent } from '@app/shared/membership/membership-badges.component';
import { toastWarning } from '@app/shared/utils/error-toast';

/**
 * The value used for "borough was never captured".
 *
 * A sentinel rather than a real borough name: legacy requests store an EMPTY STRING, not null
 * (`borough = data.borough ?: ""` on the server), and so does anything staff create in the admin
 * form, where the field is read-only. Without an explicit option for them, a borough filter would
 * silently hide a large slice of the history and look like data loss.
 */
export const BOROUGH_NOT_RECORDED = '__not_recorded__';

/**
 * Options for the borough filter — every borough the codebase knows about, not just the ones
 * currently accepted. A filter has to match historical records, including Tower Hamlets requests
 * taken during the pilot if the borough is later switched off. That is exactly what ALL_BOROUGHS
 * exists for; `supportedBoroughs()` is the wrong list here.
 */
const BOROUGH_FILTER_OPTIONS = [
  ...ALL_BOROUGHS.map(b => ({ label: b.name, value: b.name })),
  { label: 'Not recorded', value: BOROUGH_NOT_RECORDED },
];

const queryEntity = (request: string, org: string) => gql`
query findAllDeviceRequests($page: PaginationInput, $numericterm: Long, $term: String, $filter: DeviceRequestWhereInput!) {
  deviceRequestConnection(page: $page, where: {
      OR: [
        {
          AND: [ { clientRef: { _contains: $term } }, $filter ]
        }
        {
          AND: [ { id: { _eq: $numericterm } }, $filter ]
        }
        {
          AND: [ { referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } } }, $filter ]
        }
        {
          AND: [ { referringOrganisationContact: { fullName: { _contains: $term } } }, $filter ]
        }
      ]
  }){
    totalElements
    content{
     id
     status
     clientRef
     borough
     deviceRequestItems {
      phones
      tablets
      laptops
      allInOnes
      desktops
      commsDevices
      other
      broadbandHubs
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
        ${org}
      }
     }
     isPrepped
     createdAt
     updatedAt
     ${request}
    }
  }
}
`;

// Membership fields are requested only while the membership flag is on (techaid-server#311).
const QUERY_ENTITY = queryEntity('', '');
const QUERY_ENTITY_MEMBERSHIP = queryEntity('membershipGraceIndex', MEMBERSHIP_SELECTION);

const GRACE_CONFIG = gql`
query findMembershipGraceRequests {
  adminConfig {
    membershipGraceRequests
  }
}
`;

@Component({
    selector: 'app-device-request-index',
    templateUrl: './device-request-index.component.html',
    styleUrls: ['./device-request-index.component.scss'],
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe, MembershipBadgesComponent],
    // OnPush (hygiene 6.5, fanned out from the donor-index pilot, PR #111):
    // this page's state only changes via the DataTables ajax callback and the
    // filter modal. Both paths run outside the host template's event tree, so
    // they call cdr.markForCheck() explicitly.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DeviceRequestIndexComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef,
    private flags: FeatureFlagService
  ) {

  }
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'ID', key: 'id', width: '15px' },
    { title: 'Requests', sortable: false },
    { title: 'Referee', key: 'referringOrganisationContact.fullName' },
    { title: 'Organisation', key: 'referringOrganisationContact.referringOrganisation.name' },
    // Borough sits beside Organisation. This list is positional against `order` below and the
    // stored sort index, so edit them together.
    { title: 'Borough', key: 'borough' },
    { title: 'Client Ref', key: 'clientRef' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Status', key: 'status' },
    { title: 'Is Prepped', sortable: false },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  @Select(CoreWidgetState.query) search$: Observable<string>;

  statusTypes: any = DEVICE_REQUEST_STATUS;


  /** Grace allowance M for "Grace N of M"; undefined until fetched (flag on only). */
  graceTotal: number | undefined;

  filter: any = {};
  filterCount = 0;
  filterModel: any = {is_sales: [false]};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterDeviceTypes = DEVICE_TYPES;
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
          key: 'borough',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Borough?',
            options: BOROUGH_FILTER_OPTIONS,
            required: false,
          }
        },
      ]
    }
  ];

  @Input()
  tableId = 'device-request-index';

  applyFilter(data) {
    const filter = {};
    let count = 0;
    const deviceTypeLookup = DEVICE_TYPE_LOOKUP;

    if (data.status && data.status.length) {
      count = count + data.status.length;
      filter['status'] = {'_in': data.status };
    }

    if (data.is_sales && data.is_sales.length) {
      count += data.is_sales.length;
      filter['isSales'] = {_in: data.is_sales};
    }

    if (data.device_type && data.device_type.length) {
      const deviceRequestItems = { };

      data.device_type.forEach(devType => {
        if(devType in deviceTypeLookup) {
          count++;
          deviceRequestItems[deviceTypeLookup[devType]] = { _gt: 0 };
        }
      })
      filter['deviceRequestItems'] = deviceRequestItems;
    }

    if (data.is_prepped && data.is_prepped.length) {
      count += data.is_prepped.length;
      filter['isPrepped'] = {_in: data.is_prepped};
    }

    // Borough. Selecting "Not recorded" has to reach rows holding an empty string AND any holding
    // null — the server only started defaulting the column to "" at some point, so both shapes
    // exist in the data. `_in` cannot express null, hence the OR; when no blank option is
    // selected the simple `_in` is used so the common case stays a single predicate.
    if (data.borough && data.borough.length) {
      // Drop anything the option list no longer offers. A model restored from localStorage can
      // name a borough that has since been removed, and the checkbox for it would not render —
      // leaving a filtered list with a badge count and nothing visibly ticked, which reads as the
      // filter being broken. Rewrite the model so what is applied is what is shown.
      const known = new Set(BOROUGH_FILTER_OPTIONS.map(option => option.value));
      data.borough = data.borough.filter(value => known.has(value));
    }

    if (data.borough && data.borough.length) {
      count += data.borough.length;
      const named = data.borough.filter(b => b !== BOROUGH_NOT_RECORDED);
      const includeBlank = data.borough.includes(BOROUGH_NOT_RECORDED);

      if (includeBlank) {
        const alternatives: any[] = [{ borough: { _in: [''] } }, { borough: { _is_null: true } }];
        if (named.length) {
          alternatives.unshift({ borough: { _in: named } });
        }
        filter['OR'] = alternatives;
      } else {
        filter['borough'] = { _in: named };
      }
    }

    localStorage.setItem(`deviceRequestFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    // Called from the filter modal, whose view lives in NgbModal's window —
    // the host's filterCount badge won't repaint under OnPush without this.
    this.cdr.markForCheck();
    this.grid()?.reload();
  }

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
  }

  ngOnInit() {
    // Restore the saved filter before the table makes its first request (the shell starts in its own ngOnInit).
    try {
      this.filterModel = JSON.parse(localStorage.getItem(`deviceRequestFilters-${this.tableId}`)) || {is_sales: [false]};
    } catch (_) {
      this.filterModel = {is_sales: [false]};
    }
    try {
      this.applyFilter(this.filterModel);
    } catch (_) {
    }

    const queryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY,
        variables: {}
      });
    const membershipQueryRef = this.apollo
      .watchQuery({
        query: QUERY_ENTITY_MEMBERSHIP,
        variables: {}
      });

    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    this.source = async (q) => {
      const vars = {
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        term: q.term,
        numericterm: isNaN(Number(q.term)) ? -1 : Number(q.term),
        filter: this.filter
      };
      const enabled = await firstValueFrom(this.flags.isEnabled(MEMBERSHIP_FLAG).pipe(take(1)), { defaultValue: false });
      if (enabled && this.graceTotal === undefined) {
        // Optional: without it the badge just reads "Grace N".
        this.apollo.query<any>({ query: GRACE_CONFIG }).subscribe({
          next: r => {
            this.graceTotal = r.data?.adminConfig?.membershipGraceRequests ?? undefined;
            this.cdr.markForCheck();
          },
          error: () => {},
        });
      }
      const res = await (enabled ? membershipQueryRef : queryRef).refetch(vars);
      const data: any = res.data?.['deviceRequestConnection'];
      // map + spread: Apollo v4 freezes the rows, never write to them.
      const rows = (data?.content ?? []).map(d => {
        const types: Record<string, number> = {};
        const kitIds: Record<string, string[]> = {};
        (d.kits ?? []).forEach(k => {
          const typeMap: Record<string, string> = { 'SMARTPHONE': 'PHONES' };
          const t = typeMap[k.type] || `${k.type}S`;
          types[t] = (types[t] || 0) + 1;
          kitIds[t] = kitIds[t] || [];
          kitIds[t].push(k.id);
        });
        return { ...d, types, kitIds };
      });
      return { rows, total: data?.totalElements ?? 0 };
    };
  }

  onLoadError(err: any) {
    toastWarning(this.toastr, err, 'GraphQL Error', { timeOut: 15000, disableTimeOut: true });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
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
  }
}
