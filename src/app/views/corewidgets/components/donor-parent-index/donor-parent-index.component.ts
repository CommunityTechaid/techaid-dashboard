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
import { toastError, toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
query findAllDonorParents($page: PaginationInput,, $term: String, $where: DonorParentWhereInput!) {
  donorParentsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          address: { _contains: $term }
          AND: [ $where ]
        },
        {
          name: { _contains: $term }
          AND: [ $where ]
        },
        {
          website: { _contains: $term }
          AND: [ $where ]
        }
      ]
    }
  }){
    totalElements
    content{
     id
     name
     address
     website
     donorCount
     type
     createdAt
     updatedAt
     archived
     donors {
      id
      kitCount
     }
    }
  }
}
`;

const CREATE_ENTITY = gql`
mutation createDonorParent($data: CreateDonorParentInput!) {
  createDonorParent(data: $data){
    id
    name
    address
    website
    type
  }
}
`;

@Component({
    selector: 'donor-parent-index',
    styleUrls: ['donor-parent-index.scss'],
    templateUrl: './donor-parent-index.html',
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, ReactiveFormsModule, FormlyModule, DatePipe],
    // OnPush (hygiene 6.5, fanned out from the donor-index pilot, PR #111):
    // this page's state only changes via the DataTables ajax callback and the
    // filter modal. Both paths run outside the host template's event tree, so
    // they call cdr.markForCheck() explicitly.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DonorParentIndexComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false },
    { title: 'Name', key: 'name' },
    { title: 'Address', key: 'address' },
    { title: '# Donors / Devices', key: 'donorCount' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
    { title: 'Type', key: 'type' },
    { title: 'Archived', key: 'archived' },
  ];
  source: TableSource<any>;
  sub: Subscription;
  selections = {};
  selected = [];
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};

  @Select(CoreWidgetState.query) search$: Observable<string>;

  fields: FormlyFieldConfig[] = [
    {
      key: 'type',
      type: 'radio',
      className: 'px-1',
      defaultValue: 'DROPPOINT',
      templateOptions: {
       label: "Type",
       type: "select",
       options: [
          {label: 'Business', value: 'BUSINESS' },
          {label: 'Drop Point', value: 'DROPPOINT' }
       ],
       required: true
      }
    },
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
      key: 'address',
      type: 'place',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Address',
        placeholder: '',
        postCode: false,
        required: false
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'website',
          type: 'input',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Website',
            pattern: /^(https?:\/\/)?([\w\d-_]+)\.([\w\d-_\.]+)\/?\??([^#\n\r]*)?#?([^\n\r]*)/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': (model) => !model?.website?.length
          }
        }
      ]
    }
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
          key: 'type',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Type?',
            options: [
              {label: 'Business', value: 'BUSINESS' },
              {label: 'Drop Point', value: 'DROPPOINT' },
            ],
            required: false
          }
        },
        {
          key: 'archived',
          type: 'multicheckbox',
          className: 'col-sm-4',
          templateOptions: {
            type: 'array',
            label: 'Filter by Archived?',
            options: [
              {label: 'Active Parent Donors', value: false },
              {label: 'Archived Parent Donors', value: true },
            ],
            required: false,
          }
        }
      ]
    }
  ];


  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef
  ) {

  }

  applyFilter(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    const filter = {};
    let count = 0;

    if (data.type && data.type.length) {
      count += data.type.length;
      filter['type'] = {_in: data.type};
    }

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    localStorage.setItem(`donorParentFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    // Called from the filter modal, whose view lives in NgbModal's window —
    // the host's filterCount badge won't repaint under OnPush without this.
    this.cdr.markForCheck();
    this.grid()?.reload();
  }

  @Input()
  tableId = 'donor-parent-index';

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
      this.filterModel = JSON.parse(localStorage.getItem(`donorParentFilters-${this.tableId}`)) || { };
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
        where: this.filter,
      });
      const data: any = res.data?.['donorParentsConnection'];
      return { rows: (data?.content ?? []).map(d => ({
        ...d,
        deviceCount: d.donors ? d.donors.reduce((sum, k) => sum + k.kitCount, 0) : 0
      })), total: data?.totalElements ?? 0 };
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


  createEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    // The place field's clear (X) button sets null, but the server's CreateDonorParentInput.address is
    // a non-null Kotlin String: address: null fails with a raw instantiation error. Send '' instead,
    // which is what an untouched field sends.
    data = { ...data, address: data.address ?? '' };
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.grid()?.reload();
    }, err => {
      toastError(this.toastr, err, 'Create Parent Donor Error', { timeOut: 15000 });
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
