import { ChangeDetectionStrategy, ChangeDetectorRef, Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, UntypedFormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions, FormlyModule } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { RouterLink } from '@angular/router';
import { warnIfFormInvalid } from '@app/shared/utils';

const QUERY_ENTITY = gql`
query findAllDonors($page: PaginationInput, $term: String, $where: DonorWhereInput!) {
  donorsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          postCode: { _contains: $term }
          AND: [ $where ]
        },
        {
          name: { _contains: $term }
          AND: [ $where ]
        },
        {
          phoneNumber: { _contains: $term }
          AND: [ $where ]
        },
        {
          email: { _contains: $term }
          AND: [ $where ]
        }
      ]
    }
  }){
    totalElements
    content{
     id
     name
     postCode
     phoneNumber
     email
     kitCount
     createdAt
     updatedAt
     archived
     isLeadContact
     donorParent {
      id
      name
     }
    }
  }
}
`;

const CREATE_ENTITY = gql`
mutation createDonor($data: CreateDonorInput!) {
  createDonor(data: $data){
    id
    name
    email
    phoneNumber
    postCode
    isLeadContact
  }
}
`;

const AUTOCOMPLETE_DONOR_PARENTS = gql`
query findAutocompleteDonorParents($term: String) {
  donorParentsConnection(page: {
    size: 50
  }, where: {
    name: { _contains: $term }
    archived: { _eq: false }
  }){
    content  {
      id
      name
    }
  }
}
`;


@Component({
    selector: 'donor-index',
    styleUrls: ['donor-index.scss'],
    templateUrl: './donor-index.html',
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush pilot (hygiene 6.5): this page re-rendered on every app-wide CD
    // tick even though its state only changes via the DataTables ajax callback
    // and the filter modal. Both paths run outside the host template's event
    // tree, so they call cdr.markForCheck() explicitly. Modal content (create/
    // filter forms) is unaffected: NgbModal hosts those embedded views in its
    // own Default-strategy window component.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DonorIndexComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef
  ) {

  }

  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false },
    { title: 'Donor', key: 'name' },
    { title: 'Devices', key: 'kitCount' },
    { title: 'Address', key: 'postCode' },
    { title: 'Parent Donor', key: 'donorParent.name' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Archived', key: 'archived' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};
  donorParentId: number;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  donorParents$: Observable<any>;
  donorParentInput$ = new Subject<string>();
  donorParentLoading = false;
  donorParentField: FormlyFieldConfig = {
    key: 'donorParentId',
    type: 'choice',
    className: 'ms-auto text-end',
    templateOptions: {
      label: 'Parent Donor',
      description: 'The parent donor for this donor.',
      loading: this.donorParentLoading,
      typeahead: this.donorParentInput$,
      placeholder: 'Assign donor to an associated Parent Donor',
      multiple: false,
      searchable: true,
      items: [],
      required: true
    },
  };

  fields: FormlyFieldConfig[] = [
    {
      key: 'name',
      type: 'input',
      className: 'col-md-12 border-left-info card pt-3 mb-3',
      defaultValue: '',
      templateOptions: {
        label: 'Name',
        placeholder: '',
        required: true
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'email',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Email',
            type: 'email',
            pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            placeholder: '',
            required: true
          },
          expressionProperties: {
            'templateOptions.required': (model) => !model?.phoneNumber?.length,
          },
        },
        {
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Phone Number',
            pattern: /\+?[0-9]+/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': (model) => !model?.email?.length,
          },
        }
      ]
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'postCode',
          type: 'place',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Address',
            placeholder: '',
            postCode: false,
            required: false
          },
          validation: {
            show: false,
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
          },
        },
        {
          key: 'isLeadContact',
          type: 'checkbox',
          className: 'col-md-6 text-right mt-4',
          defaultValue: false,
          templateOptions: {
            label: 'Is a lead contact?',
            placeholder: 'This preserves contacts for drop points so they kept permanently',
            required: false,
            labelPosition: "before"
          },
          validation: {
            show: false
          }
        }
      ]
    },
    this.donorParentField
  ];

  filter: any = {};
  filterCount = 0;
  filterModel: any = {};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'archived',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Archived?',
            options: [
              {label: 'Active Donors', value: false },
              {label: 'Archived Donors', value: true },
            ],
            required: false,
          }
        }
      ]
    }
  ];


  @Input()
  tableId = 'donor-index';

  applyFilter(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    const filter = {};
    let count = 0;
    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }
    localStorage.setItem(`donorFilters-${this.tableId}`, JSON.stringify(data));
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
      this.filterModel = JSON.parse(localStorage.getItem(`donorFilters-${this.tableId}`)) || { };
    } catch (_) {
      this.filterModel = { };
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
          term: term
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

    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    this.sub.add(this.donorParents$.subscribe(data => {
      this.donorParentField.templateOptions['items'] = data;
    }));

    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        term: q.term,
        where: this.filter,
      });
      const data: any = res.data?.['donorsConnection'];
      return { rows: data?.content ?? [], total: data?.totalElements ?? 0 };
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

  createEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.grid()?.reload();
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Donor Error', {
          enableHtml: true,
          timeOut: 15000
        });
    });
  }

  select(row: any) {
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
