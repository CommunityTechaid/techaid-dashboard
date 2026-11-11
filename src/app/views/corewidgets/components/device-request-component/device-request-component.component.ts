import { Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy, ChangeDetectionStrategy, signal } from '@angular/core';
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
import { DEVICE_TYPES, DEVICE_TYPE_LOOKUP } from '@app/shared/utils';
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { MEMBERSHIP_FLAG } from '@app/shared/membership/membership';
import { MembershipBadgesComponent } from '@app/shared/membership/membership-badges.component';

const queryEntity = (request: string) => gql`
query findAllOrgs(
  $page: PaginationInput,
  $where: DeviceRequestWhereInput!,
  $term: String,
  $filter: DeviceRequestWhereInput!) {
  deviceRequestConnection(page: $page, where: {
    AND: [$where, $filter]
    OR: [
      {
        referringOrganisationContact: { phoneNumber: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { referringOrganisation: { name: { _contains: $term } } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { fullName: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        referringOrganisationContact: { email: { _contains: $term } }
        AND: [$where, $filter]
      },
      {
        clientRef: { _contains: $term }
        AND: [$where, $filter]
      }
    ]

  }){
    totalElements
    content{
      id
      status
      clientRef
      referringOrganisationContact {
        id
        phoneNumber
        fullName
        email
        address
        referringOrganisation {
          id
          name
        }
      }
      createdAt
      updatedAt
      details
      kitCount
      kits {
        type
      }
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
      ${request}
    }
  }
}
`;

// Membership fields are requested only while the membership flag is on (techaid-server#311).
const QUERY_ENTITY = queryEntity('');
const QUERY_ENTITY_MEMBERSHIP = queryEntity('membershipGraceIndex');

const GRACE_CONFIG = gql`
query findMembershipGraceRequests {
  adminConfig {
    membershipGraceRequests
  }
}
`;

@Component({
    selector: 'device-request-component',
    styleUrls: ['device-request-component.component.scss'],
    templateUrl: './device-request-component.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe, MembershipBadgesComponent]
})
export class DeviceRequestComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private flags: FeatureFlagService
  ) { }

  /** Grace allowance M for "Grace N of M"; undefined until fetched (flag on only). A signal: it is set from an Apollo callback (#115). */
  readonly graceTotal = signal<number | undefined>(undefined);

  @Input()
  set where(where: any) {
    const serialised = JSON.stringify(where);
    if (serialised === this._whereSerialized) {
      return;
    }
    this._whereSerialized = serialised;
    this._where = where;
    if (this.grid()) {
      this.applyFilter(this.filterModel);
    }
  }

  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: 'ID', key: 'id', width: '15px' },
    { title: 'Requests', key: 'kitCount' },
    { title: 'Referee', key: 'referringOrganisationContact.fullName' },
    { title: 'Organisation', key: 'referringOrganisationContact.referringOrganisation.name' },
    { title: 'Client Ref', key: 'clientRef' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Status', key: 'status' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  @Select(CoreWidgetState.query) search$: Observable<string>;

  statusTypes: any = DEVICE_REQUEST_STATUS;


  filter: any = {};
  // A signal: applyFilter runs from the NgbModal footer (a separate view root), so the badge repaints without zone.js (#115).
  readonly filterCount = signal(0);
  filterModel: any = {archived: [false]};
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
        // {
        //   key: 'accepts',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [],
        //   templateOptions: {
        //     label: 'Accepts',
        //     type: 'array',
        //     options: [
        //       {label: 'Laptop', value: 'LAPTOPS' },
        //       {label: 'Tablet', value: 'TABLETS' },
        //       {label: 'Smart Phone', value: 'PHONES' },
        //       {label: 'All In One (PC)', value: 'ALLINONES' },
        //       {label: 'Desktop', value: 'DESKTOPS' },
        //       {label: 'Connectivity Device', value: 'COMMSDEVICES' }
        //     ]
        //   }
        // },
        // {
        //   key: 'needs',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [],
        //   templateOptions: {
        //     label: 'Client needs',
        //     type: 'array',
        //     options: [
        //       {value: 'internet', label: 'Has no home internet'},
        //       {value: 'mobility' , label: 'Mobility issues'},
        //       {value: 'training', label: 'Training needs'}
        //     ]
        //   }
        // },
        // {
        //   key: 'archived',
        //   type: 'multicheckbox',
        //   className: 'col-sm-4',
        //   defaultValue: [false],
        //   templateOptions: {
        //     type: 'array',
        //     label: 'Filter by Archived?',
        //     options: [
        //       {label: 'Active Requests', value: false },
        //       {label: 'Archived Requests', value: true },
        //     ],
        //     required: false,
        //   }
        // }
      ]
    }
  ];

  @Input()
  tableId = 'device-request-component';

  _where = {};
  _whereSerialized = '{}';

  applyFilter(data) {
    const filter = {};
    let count = 0;
    const deviceTypeLookup = DEVICE_TYPE_LOOKUP;


    // if (data.accepts && data.accepts.length) {
    //   count = count + data.accepts.length;
    //   filter['accepts'] = {'_in': data.accepts };
    // }

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


    // if (data.needs && data.needs.length) {
    //   count = count + data.needs.length;
    //   filter['needs'] = {'_in': data.needs };
    // }

    // if (data.archived && data.archived.length) {
    //   count += data.archived.length;
    //   filter['archived'] = {_in: data.archived};
    // }

    localStorage.setItem(`orgFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount.set(count);
    this.filterModel = data;
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
    // Apply the default filter before the table makes its first request (the shell starts in its own ngOnInit).
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
        where: this.filter,
        term: q.term,
        filter: this._where || this.filter
      };
      const enabled = await firstValueFrom(this.flags.isEnabled(MEMBERSHIP_FLAG).pipe(take(1)), { defaultValue: false });
      if (enabled && this.graceTotal() === undefined) {
        // Optional: without it the badge just reads "Grace N".
        this.apollo.query<any>({ query: GRACE_CONFIG }).subscribe({
          next: r => {
            this.graceTotal.set(r.data?.adminConfig?.membershipGraceRequests ?? undefined);
          },
          error: () => {},
        });
      }
      const res = await (enabled ? membershipQueryRef : queryRef).refetch(vars);
      const data: any = res.data?.['deviceRequestConnection'];
      // map + spread: Apollo v4 freezes the rows, never write to them.
      const rows = (data?.content ?? []).map(d => {
        const types: Record<string, number> = {};
        (d.kits ?? []).forEach(k => {
          const typeMap: Record<string, string> = { 'SMARTPHONE': 'PHONES' };
          const t = typeMap[k.type] || `${k.type}S`;
          types[t] = (types[t] || 0) + 1;
        });
        return { ...d, types };
      });
      return { rows, total: data?.totalElements ?? 0 };
    };
  }

  onLoadError(err: any) {
    this.toastr.warning(`
      <small>${err?.message}</small>
    `, 'GraphQL Error', {
        enableHtml: true,
        timeOut: 15000,
        disableTimeOut: true
      });
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
