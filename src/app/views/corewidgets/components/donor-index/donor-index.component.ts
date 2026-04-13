import { Component, ViewChild, ViewEncapsulation, Input } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, UntypedFormGroup, FormBuilder, Validators } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import * as Tablesaw from 'tablesaw';
import 'datatables.net-responsive';
import 'datatables.net-rowreorder';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';

const QUERY_ENTITY = gql`
query findAllDonors($page: PaginationInput, $term: String, $where: DonorWhereInput!) {
  donorsConnection(page: $page, where: {
    AND: {
      postCode: { _contains: $term }
      AND: [ $where ]
      OR: [
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
  templateUrl: './donor-index.html'
})
export class DonorIndexComponent {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }

  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
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
    className: 'px-2 ml-auto justify-content-end text-right',
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

  fields: Array<FormlyFieldConfig> = [
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
            'templateOptions.required': 'model.phoneNumber.length == 0',
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
            'templateOptions.required': 'model.email.length == 0',
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
            'validation.show': 'model.showErrorState',
            'templateOptions.disabled': 'formState.disabled',
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
  filterFields: Array<FormlyFieldConfig> = [
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
    this.table.ajax.reload(null, false);
  }

  modal(content) {
    this.modalService.open(content, { centered: true, size: 'lg' });
  }

  clearSelection() {
    this.selections = {};
    this.selected = [];
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
          catchError(() => of([])),
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
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    this.sub.add(this.donorParents$.subscribe(data => {
      this.donorParentField.templateOptions['items'] = data;
    }));

    this.dtOptions = {
      pagingType: 'simple_numbers',
      dom:
        '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
        '<\'row\'<\'col-sm-12\'tr>>' +
        '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      pageLength: 10,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [5, 'desc'],
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: true,
      ajax: (params: any, callback) => {
        const sort = params.order.map(o => {
          return {
            key: this.dtOptions.columns[o.column].data,
            value: o.dir
          };
        });

        const vars = {
          page: {
            sort: sort,
            size: params.length,
            page: Math.round(params.start / params.length),
          },
          term: params['search']['value'],
          where: this.filter
        };

        queryRef.refetch(vars).then(res => {
          let data: any = {};
          if (res.data) {
            data = res['data']['donorsConnection'];
            if (!this.total) {
              this.total = data['totalElements'];
            }
            this.entities = data.content;
          }

          callback({
            draw: params.draw,
            recordsTotal: this.total,
            recordsFiltered: data['totalElements'],
            error: '',
            data: []
          });
        }, err => {
          callback({
            draw: params.draw,
            recordsTotal: this.total || 0,
            recordsFiltered: 0,
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
        { data: null, width: '15px', orderable: false },
        { data: 'name' },
        { data: 'kitCount'},
        { data: 'postCode' },
        { data: 'donorParent.name' },
        { data: 'createdAt' },
        { data: 'updatedAt' },
        { data: 'archived' }
      ]
    };
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

  ngAfterViewInit() {
    this.grid.dtInstance.then(tbl => {
      this.table = tbl;
      try {
        this.filterModel = JSON.parse(localStorage.getItem(`donorFilters-${this.tableId}`)) || { };
      } catch (_) {
        this.filterModel = { };
      }
      try {
        this.applyFilter(this.filterModel);
        this.filterForm.patchValue(this.filterModel);
      } catch (_) {
      }
    });
  }

  createEntity(data: any) {
    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.total = null;
      this.table.ajax.reload(null, false);
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
