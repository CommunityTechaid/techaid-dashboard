import { ChangeDetectionStrategy, ChangeDetectorRef, Component, viewChild, ViewEncapsulation, Input, OnInit, OnDestroy } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
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
query findAllDonors(
  $page: PaginationInput,
  $term: String,
  $filter: DonorWhereInput!,
  $where: DonorWhereInput!) {
  donorsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          postCode: { _contains: $term }
          AND: [ $filter, $where ]
        },
        {
          name: { _contains: $term }
          AND: [ $filter, $where ]
        },
        {
          phoneNumber: { _contains: $term }
          AND: [ $filter, $where ]
        },
        {
          email: { _contains: $term }
          AND: [ $filter, $where ]
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

@Component({
    selector: 'donor-component',
    styleUrls: ['donor-component.scss'],
    templateUrl: './donor-component.html',
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush (hygiene 6.5 fan-out, #114): host-bound state changes only via the
    // DataTables ajax callback and applyFilter(), so both call cdr.markForCheck().
    // createEntity()'s mutation subscribe reloads the table immediately, so its
    // repaint is covered by the ajax callback's own markForCheck.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DonorComponent implements OnInit, OnDestroy {
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

  @Input()
  set where(where: any) {
    this._where = where;
    if (this.grid()) {
      this.applyFilter(this.filterModel);
    }
  }

  @Input()
  set donorParentId(donorParentId: any) {
    this._donorParentId = donorParentId;
  }

  @Select(CoreWidgetState.query) search$: Observable<string>;

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
            required: false
          },
          validation: {
            show: false
          }
        }
      ]
    },
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
  tableId = 'donor-component-index';

  _where = {};
  _donorParentId = -1;

  // Guards the Filter-modal submit button specifically; applyFilter itself stays
  // unguarded because it's also called internally from the `where` @Input setter
  // and on initial load, which don't go through filterForm.
  applyFilterFromModal(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    this.applyFilter(data);
  }

  applyFilter(data) {
    const filter = {};
    let count = 0;
    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }
    localStorage.setItem(`donorComponentFilters-${this.tableId}`, JSON.stringify(data));
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
      this.filterModel = JSON.parse(localStorage.getItem(`donorComponentFilters-${this.tableId}`)) || { };
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


    this.sub = this.search$.subscribe(query => {
      this.grid()?.search(query);
    });

    this.source = async (q) => {
      const res = await queryRef.refetch({
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        term: q.term,
        where: this._where,
        filter: this.filter || this._where,
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

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  createEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    data.donorParentId = this._donorParentId;

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
