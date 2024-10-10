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
query findAllDonors(
  $page: PaginationInput,
  $term: String,
  $where: DonorWhereInput!) {
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
     consent
     donorParent {
      id
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
    type
  }
}
`;

@Component({
  selector: 'donor-component',
  styleUrls: ['donor-component.scss'],
  templateUrl: './donor-component.html'
})
export class DonorComponent {
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
  form: FormGroup = new FormGroup({});
  model = {};

  @Input()
  set where(where: any) {
    this._where = where;
  }

  @Input()
  set donorParentId(donorParentId: any) {
    this._donorParentId = donorParentId;
  }

  @Select(CoreWidgetState.query) search$: Observable<string>;

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
      key: 'postCode',
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
      key: 'type',
      type: 'radio',
      className: 'px-1',
      defaultValue: 'INDIVIDUAL',
      templateOptions: {
       label: "Donor Type",
       type: "select",
       options: [
          {label: 'Individual', value: 'INDIVIDUAL' },
          {label: 'Business', value: 'BUSINESS' }
       ],
       required: true
      }
    },
  ];

  @Input()
  tableId = 'donor-component-index';

  _where = {};
  _donorParentId = -1;

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
      order: [3, 'desc'],
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
          where: this._where
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
        { data: 'email' },
        { data: 'kitCount'},
        { data: 'postCode' },
        { data: 'createdAt' },
        { data: 'updatedAt' }
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
    });
  }


  createEntity(data: any) {
    data.donorParentId = this._donorParentId;

    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.total = null;
      this.table.ajax.reload(null, false);
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Volunteer Error', {
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
