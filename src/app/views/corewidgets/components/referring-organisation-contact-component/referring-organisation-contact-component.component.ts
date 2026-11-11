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
import { DatePipe } from '@angular/common';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, TableSource } from '@app/shared/modules/native-table/table-types';
import { RouterLink } from '@angular/router';
import { warnIfFormInvalid } from '@app/shared/utils';
import { take } from 'rxjs/operators';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { MEMBERSHIP_FLAG } from '@app/shared/membership/membership';
import { MembershipBadgesComponent } from '@app/shared/membership/membership-badges.component';

const queryEntity = (contact: string) => gql`
query findAllReferringOrgContacts(
  $page: PaginationInput,
  $where: ReferringOrganisationContactWhereInput!,
  $term: String,
  $filter: ReferringOrganisationContactWhereInput!) {
  referringOrganisationContactsConnection(page: $page, where: {
    AND: {
      OR: [
        {
          fullName: { _contains: $term }
          AND: [$filter, $where]
        },
        {
          phoneNumber: { _contains: $term }
          AND: [$filter, $where]
        },
        {
          email: { _contains: $term }
          AND: [$filter, $where]
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
     archived
     referringOrganisation {
      id
      name
     }
     createdAt
     updatedAt
     ${contact}
    }
  }
}
`;

// Membership fields are requested only while the membership flag is on (techaid-server#311).
const QUERY_ENTITY = queryEntity('');
const QUERY_ENTITY_MEMBERSHIP = queryEntity('isMembershipContact');

const CREATE_ENTITY = gql`
mutation createReferringOrganisationContact($data: CreateReferringOrganisationContactInput!) {
  createReferringOrganisationContact(data: $data){
     id
  }
}
`;

@Component({
    selector: 'referee-component',
    templateUrl: './referring-organisation-contact-component.component.html',
    styleUrls: ['./referring-organisation-contact-component.component.scss'],
    imports: [NativeTableComponent, NativeTableRowDirective, RouterLink, NgbTooltip, ReactiveFormsModule, FormlyModule, DatePipe, MembershipBadgesComponent],
    // OnPush (hygiene 6.5 fan-out, #114): host-bound state changes only via the
    // DataTables ajax callback and applyFilter(), so both call cdr.markForCheck().
    // createEntity()'s mutation subscribe reloads the table immediately, so its
    // repaint is covered by the ajax callback's own markForCheck.
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReferringOrganisationContactComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo,
    private cdr: ChangeDetectorRef,
    private flags: FeatureFlagService
  ) {

  }


  @Input()
  set where(where: any) {
    this._where = where;
    if (this.grid()) {
      this.applyFilter(this.filterModel);
    }
  }

  @Input()
  set orgId(orgId: any) {
    this._orgId = orgId;
  }


  readonly grid = viewChild(NativeTableComponent<any>);
  readonly columns: TableColumn[] = [
    { title: '', width: '15px', sortable: false },
    { title: 'Name', key: 'fullName' },
    { title: 'Email', key: 'email' },
    { title: 'Phone', key: 'phoneNumber' },
    { title: 'Requests #', key: 'requestCount' },
    { title: 'Organisation', key: 'referringOrganisation.name' },
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

  @Select(CoreWidgetState.query) search$: Observable<string>;

  fields: FormlyFieldConfig[] = [
    {
      key: 'fullName',
      type: 'input',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Full Name',
        placeholder: 'Please enter referee\'s full name eg: John Doe',
        required: true
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': (model) => !!model?.showErrorState,
      }
    },
    {
      key: 'email',
      type: 'input',
      className: 'col-md-10',
      defaultValue: '',
      templateOptions: {
        label: 'Email',
        type: 'email',
        placeholder: 'Referee email address',
        pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        required: true
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': (model) => !!model?.showErrorState,
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
            'templateOptions.required': (model) => !model?.phoneNumber?.length
          }
        }
      ]
    },
    {
      key: 'address',
      type: 'place',
      className: 'col-md-12',
      defaultValue: '',
      templateOptions: {
        label: 'Referee Address',
        placeholder: 'Your address',
        required: true
      },
      validation: {
        show: false
      },
      expressionProperties: {
        'validation.show': (model) => !!model?.showErrorState,
      }
    }
  ];

  filter: any = {};
  filterCount = 0;
  filterModel: any = {archived: [false]};
  filterForm: UntypedFormGroup = new UntypedFormGroup({});
  filterFields: FormlyFieldConfig[] = [
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
              {label: 'Active Referees', value: false },
              {label: 'Archived Referees', value: true },
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
  _orgId = -1;

  // Guards the Filter-modal submit button specifically; applyFilter itself stays
  // unguarded because it's also called internally from the `where` @Input setter
  // and on initial load, which don't go through filterForm.
  applyFilterFromModal(data) {
    if (warnIfFormInvalid(this.filterForm, this.filterFields, this.toastr)) return;
    this.applyFilter(data);
  }

  applyFilter(data) {
    const filter = {'OR': [], 'AND': []};
    let count = 0;

    if (data.archived && data.archived.length) {
      count += data.archived.length;
      filter['archived'] = {_in: data.archived};
    }

    localStorage.setItem(`referringOrgContactComponentFilters-${this.tableId}`, JSON.stringify(data));
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
      this.filterModel = JSON.parse(localStorage.getItem(`referringOrgContactComponentFilters-${this.tableId}`)) || {archived: [false]};
    } catch (_) {
      this.filterModel = {archived: [false]};
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
      const vars: any = {
        page: {
          sort: q.sort.map(s => ({ key: s.key, value: s.dir })),
          size: q.size,
          page: q.page,
        },
        where: this._where,
        term: q.term,
        filter: this.filter
      };
      const enabled = await firstValueFrom(this.flags.isEnabled(MEMBERSHIP_FLAG).pipe(take(1)), { defaultValue: false });
      const res = await (enabled ? membershipQueryRef : queryRef).refetch(vars);
      const data: any = res.data?.['referringOrganisationContactsConnection'];
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

  createEntity(data: any) {
    if (warnIfFormInvalid(this.form, this.fields, this.toastr)) return;
    data.referringOrganisation = this._orgId;

    this.apollo.mutate({
      mutation: CREATE_ENTITY,
      variables: { data }
    }).subscribe(data => {
      this.grid()?.reload();
    }, err => {
      this.toastr.error(`
      <small>${err.message}</small>
      `, 'Create Referee Error', {
          enableHtml: true,
          timeOut: 15000
        });
    });
  }
}
