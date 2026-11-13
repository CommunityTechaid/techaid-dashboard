import { ChangeDetectionStrategy, ChangeDetectorRef, Component, viewChild, Input, OnInit, OnDestroy, signal } from '@angular/core';
import {
  concat,
  Subject,
  of,
  Observable,
  Subscription,
  from,
} from 'rxjs';
import { KIT_TYPES, warnIfFormInvalid } from '@app/shared/utils';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
  catchError,
} from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { RouterLink } from '@angular/router';
import { toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
  query findAllKits(
    $page: PaginationInput,
    $term: String,
    $where: KitWhereInput!,
    $filter: KitWhereInput!
  ) {
    kitsConnection(
      page: $page
      where: {
        AND: [
          $where,
          $filter,
          {
            # Same searchable fields as kit-index, plus location. The id and serialNo branches
            # were missing, so the Devices tab could not find a kit by the id badge it shows.
            OR: [
              { model: { _contains: $term } },
              { location: { _contains: $term } },
              { serialNo: { _contains: $term } },
              { id: { _contains: $term } }
            ]
          }
        ]
      }
    ) {
      totalElements
      number
      content {
        id
        make
        model
        age
        type
        status
        location
        updatedAt
        createdAt
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

const AUTOCOMPLETE_DEVICE_REQUESTS = gql`
  query findAutocompleteDeviceRequests($term: String, $ids: [Long!]) {
    deviceRequestConnection(
      page: { size: 50 }
      where: {
        OR: [
          { id: { _in: $ids } }
          { id: { _contains: $term }}
          { referringOrganisationContact: {referringOrganisation: {name: { _contains: $term }}}}
          { referringOrganisationContact: {fullName: { _contains: $term } }}
          { referringOrganisationContact: {email: { _contains: $term } }}
        ]
      }
    ) {
      content {
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

@Component({
    selector: 'kit-component',
    styleUrls: ['kit-component.scss'],
    templateUrl: './kit-component.html',
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush (hygiene 6.5 fan-out, #114). Host-bound state changes only via the
    // DataTables ajax callback and applyFilter(), so both call cdr.markForCheck().
    // The user$ and deviceRequests$ subscriptions, and the FIND_USERS lookup in
    // ngAfterViewInit, only ever populate formly field `items`/`hide` consumed by
    // the filter modal — NgbModal hosts that view in its own Default-strategy
    // window component, so it repaints on its own.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class KitComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef
  ) {}
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
    { title: '', width: '15px', sortable: false },
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
  selections = {};
  selected = [];
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

  filter: any = {};
  // Signals: written from the NgbModal filter footer (its own view root) and the table source (#115).
  readonly filterCount = signal(0);
  filterModel: any = {};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterOptions: FormlyFormOptions = {};
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
          },
        },
        {
          key: 'age',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            label: 'Roughly how old is your device?',
            type: 'array',
            options: [
              { label: 'Less than a year', value: 1 },
              { label: '1 - 2 years', value: 2 },
              { label: '3 - 4 years', value: 4 },
              { label: '5 - 6 years', value: 5 },
              { label: 'More than 6 years old', value: 6 },
              { label: 'I don\'t know!', value: 0 },
            ],
            required: false,
          },
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
          },
        },
        {
          key: 'status',
          type: 'choice',
          className: 'col-md-12',
          templateOptions: {
            label: 'Status of the device',
            items: KIT_STATUS_LABELS,
            multiple: true,
            required: false,
          },
        },
        this.deviceRequestField,
        this.donorParentField
      ],
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
          },
          validation: {
            show: false
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
          }
            },
        {
          key: 'before',
          type: 'date',
          className: 'col-md-6',
          templateOptions: {
            label: 'Devices created on or before?',
            required: false
          },
          validation: {
            show: false
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
          }
        },
      ]
    }
  ];

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 5;

  @Input()
  tableId = 'kit-component';

  @Input()
  title = 'Devices';

  @Input()
  set donorParentId(donorParentId: any) {
    this._donorParentId = donorParentId;
    this.filterModel.donorParentId = this._donorParentId;
  }

  _donorParentId = -1;
  _where = {};
  _whereSerialized = '{}';

  // Guards the Filter-modal submit button specifically; applyFilter itself stays
  // unguarded because it's also called internally from the `where` @Input setter
  // and on initial load, which don't go through filterForm.
  applyFilterFromModal(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    this.applyFilter(data);
  }

  applyFilter(data) {
    const filter: any = {};
    let count = 0;
    if(this._donorParentId != -1 && !data.donorParentId) {
      data.donorParentId = this._donorParentId;
    }

    if (data.type && data.type.length) {
      count = count + data.type.length;
      filter['type'] = {'_in': data.type };
    }

    if (data.status && data.status.length) {
      count = count + data.status.length;
      filter['status'] = {'_in': data.status };
    }

    if (data.age && data.age.length) {
      count = count + data.age.length;
      filter['age'] = {'_in': data.age };
    }

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    if (data.donorParentId && data.donorParentId.length) {
      count += data.donorParentId.length;
      filter['donor'] = {donorParent: {id: {_in: data.donorParentId}}};
    }

    if (data.deviceRequestIds && data.deviceRequestIds.length) {
      count += data.deviceRequestIds.length;
      filter['deviceRequest'] = { id: { _in: data.deviceRequestIds } };
    }

    if(data.after){
      count += 1;
      filter['AND'] = filter['AND'] || [];
      filter['AND'].push({createdAt: {_gt: data.after }});
    }

    if(data.before){
      const endDate : Date = data.before;
      endDate.setDate(endDate.getDate() + 1);

      count += 1;
      filter['AND'] = filter['AND'] || [];
      filter['AND'].push({createdAt: {_lt: endDate }});
    }

    localStorage.setItem(`kitFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount.set(count);
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
      this.filterModel =
        JSON.parse(localStorage.getItem(`kitFilters-${this.tableId}`)) || {};
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
          .then((res) => {
            if (res.data) {
              if (res.data['deviceRequests']) {
                this.deviceRequestField.templateOptions['items'] = res.data['deviceRequests'].map((v) => {
                  return { label: this.deviceRequestName(v), value: v.id };
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
    } catch (_) {
      this.filterModel = {};
    }

    try {
      this.applyFilter(this.filterModel);
      this.filterForm.patchValue(this.filterModel);
    } catch (_) {}

    const queryRef = this.apollo.watchQuery({
      query: QUERY_ENTITY,
      variables: {},
    });

    const deviceRequestRef = this.apollo.watchQuery({
      query: AUTOCOMPLETE_DEVICE_REQUESTS,
      variables: {},
    });

    this.sub = this.search$.subscribe((query) => {
      this.grid()?.search(query);
    });

    this.deviceRequests$ = concat(
      of([]),
      this.deviceRequestInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => (this.deviceRequestLoading = true)),
        switchMap((term) =>
          from(
            deviceRequestRef.refetch({
              term: term,
              ids: this.filterModel.deviceRequestIds || [],
            })
          ).pipe(
            catchError(() => {
              this.toastr.error('Failed to load device requests for filter');
              return of([]);
            }),
            tap(() => (this.deviceRequestLoading = false)),
            switchMap((res) => {
              const data = res['data']['deviceRequestConnection'][
                'content'
              ].map((v) => {
                return {
                  label: this.deviceRequestName(v),
                  value: v.id,
                };
              });
              return of(data);
            })
          )
        )
      )
    );

    this.sub.add(
      this.deviceRequests$.subscribe((data) => {
        this.deviceRequestField.templateOptions['items'] = data;
      })
    );

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        const isDonorParentAdmin = (user && user.authorities && user.authorities['read:donorParents']);
        this.donorParentField.hide = !isDonorParentAdmin;
        this.filterOptions.detectChanges?.(this.filterFields[0]);
      })
    );

    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        where: this.filter,
        filter: this._where || {},
        term: q.term,
      });
      const data: any = res.data?.['kitsConnection'];
      // map + spread: Apollo v4 freezes the rows, never write to them.
      const rows = (data?.content ?? []).map(d => (d.donor ? { ...d, donorName: this.donorName(d.donor) } : d));
      return { rows, total: data?.totalElements ?? 0 };
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
    return `${data.name || ''}||${data.email || ''}`
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
