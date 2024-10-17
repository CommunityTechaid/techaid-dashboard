import { Component, ViewChild, ViewEncapsulation, Input } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { query } from '@angular/animations';
import { FormControl, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError } from 'rxjs/operators';
import { Select } from '@ngxs/store';
import * as Tablesaw from 'tablesaw';
import 'datatables.net-responsive';
import 'datatables.net-rowreorder';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';

const QUERY_ENTITY = gql`
query findAllDonorParents($page: PaginationInput,, $term: String, $where: DonorParentWhereInput!) {
  donorParentsConnection(page: $page, where: {
    AND: {
      address: { _contains: $term }
      AND: [ $where ]
      OR: [
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
  templateUrl: './donor-parent-index.html'
})
export class DonorParentIndexComponent {
  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
  form: FormGroup = new FormGroup({});
  model = {};

  @Select(CoreWidgetState.query) search$: Observable<string>;

  fields: Array<FormlyFieldConfig> = [
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
            'templateOptions.required': '!model.website.length'
          }
        }
      ]
    }
  ];


  filter: any = {};
  filterCount = 0;
  filterModel: any = {};
  filterForm: FormGroup = new FormGroup({});
  filterFields: Array<FormlyFieldConfig> = [
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
        }
      ]
    }
  ];


  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }

  applyFilter(data) {
    const filter = {};
    let count = 0;

    if (data.type && data.type.length) {
      count += data.type.length;
      filter['type'] = {_in: data.type};
    }

    localStorage.setItem(`donorFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    this.table.ajax.reload(null, false);
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
      order: [4, 'desc'],
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
            data = res['data']['donorParentsConnection'];
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
        { data: 'address' },
        { data: 'donorCount'},
        { data: 'createdAt' },
        { data: 'updatedAt' },
        { data: 'type' }
      ]
    };
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
        this.filterModel = JSON.parse(localStorage.getItem(`donorParentFilters-${this.tableId}`)) || { };
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
      `, 'Create Parent Donor Error', {
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
