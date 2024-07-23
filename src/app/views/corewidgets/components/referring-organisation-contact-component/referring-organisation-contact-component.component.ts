import { Component, ViewChild, ViewEncapsulation, Input } from '@angular/core';
import { Observable, Subscription, from, Subject, concat, of } from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';

const QUERY_ENTITY = gql`
query findAllReferringOrgContacts(
  $page: PaginationInput,, $term: String, $filter: ReferringOrganisationContactWhereInput!) {
  referringOrganisationContactsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          fullName: {
            _contains: $term
          }
          AND: [$filter]
        },
        {
          phoneNumber: {
            _contains: $term
          }
          AND: [$filter]
        },
        {
          email: {
            _contains: $term
          }
          AND: [$filter]
        }
      ]
    }
  }){
    totalElements
    content{
     id
     fullName
     email
     phoneNumber
     requestCount
     referringOrganisation {
      id
      name
     }
     createdAt
     updatedAt
    }
  }
}
`;

@Component({
  selector: 'referee-component',
  templateUrl: './referring-organisation-contact-component.component.html',
  styleUrls: ['./referring-organisation-contact-component.component.scss']
})
export class ReferringOrganisationContactComponent {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }


  @Input()
  set where(where: any) {
    this._where = where;
    if (this.table) {
      this.applyFilter(this.filterModel);
    }
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

  @Select(CoreWidgetState.query) search$: Observable<string>;

  fields: Array<FormlyFieldConfig> = [
    {
      key: 'name',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Name',
        placeholder: '',
        required: true
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': 'model.showErrorState',
      }
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Referee Phone Number',
            pattern: /\+?[0-9]+/,
            required: true
          },
          expressionProperties: {
            'templateOptions.required': '!model.phoneNumber.length'
          }
        }
      ]
    },
  ];

  filter: any = {};
  filterCount = 0;
  filterModel: any = {archived: [false]};
  filterForm: FormGroup = new FormGroup({});
  filterFields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'archived',
          type: 'multicheckbox',
          className: 'col-sm-4',
          defaultValue: [false],
          templateOptions: {
            type: 'array',
            label: 'Filter by Archived?',
            options: [
              {label: 'Active Requests', value: false },
              {label: 'Archived Requests', value: true },
            ],
            required: false,
          }
        }
      ]
    }
  ];

  @Input()
  tableId = 'referring-org-contact-index';

  @Input()
  pageLength = 5;

  @Input()
  title = 'Referring Organisation Contacts';

  _where = {};

  applyFilter(data) {
    const filter = {'OR': [], 'AND': []};
    let count = 0;

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    localStorage.setItem(`referringOrgContactFilters-${this.tableId}`, JSON.stringify(data));
    this.filter = filter;
    this.filterCount = count;
    this.filterModel = data;
    this.table.ajax.reload(null, false);
    console.log(this.filter)
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
      pageLength: this.pageLength,
      lengthMenu: [ 5, 10, 25, 50, 100 ],
      order: [7, 'desc'],
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: true,
      stateDuration: -1,
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
          filter: this._where || this.filter

        };

        queryRef.refetch(vars).then(res => {
          let data: any = {};
          if (res.data) {
            data = res['data']['referringOrganisationContactsConnection'];
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
        { data: 'fullName' },
        { data: 'email' },
        { data: 'phoneNumber'},
        { data: 'requestCount' },
        { data: 'referringOrganisation.name' },
        { data: 'createdAt'},
        { data: 'updatedAt' },
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
        this.filterModel = JSON.parse(localStorage.getItem(`referringOrgContactFilters-${this.tableId}`)) || {archived: [false]};
      } catch (_) {
        this.filterModel = {archived: [false]};
      }

      try {
        this.applyFilter(this.filterModel);
        this.filterForm.patchValue(this.filterModel);
      } catch (_) {
      }
    });
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
