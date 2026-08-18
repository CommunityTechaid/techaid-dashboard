import { Component, ViewChild, Input, OnInit, OnDestroy } from '@angular/core';
import {
  concat,
  Subject,
  of,
  Observable,
  Subscription,
  from,
} from 'rxjs';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  tap,
  catchError,
} from 'rxjs/operators';
import { Select } from '@ngxs/store';
import 'datatables.net-responsive';
import 'datatables.net-rowreorder';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS, KIT_STATUS_LABELS } from '../kit-info/kit-info.component';
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
import { DatePipe } from '@angular/common';

const QUERY_ENTITY = gql`
  query getAuditTrail($id: Long!) {
    kitAudits(where: $id) {
      changedNothingAudited
      siblingKitsInRevision
      revision {
        id
        timestamp
        customUser
      }
      type
      entity {
        model
        status
        serialNo
        updatedAt
        createdAt
        subStatus {
          installationOfOSFailed
          wipeFailed
          needsSparePart
          needsFurtherInvestigation
          network
          installedOSName
          lockedToUser
        }
      }
    }
  }
`;

@Component({
    selector: 'kit-audit-component',
    styleUrls: ['kit-audit-component.scss'],
    templateUrl: './kit-audit-component.html',
    imports: [AppGridDirective_1, DatePipe]
})
export class KitAuditComponent implements OnInit, OnDestroy {

  constructor(
    private modalService: NgbModal,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {}

  @Input()
  set kitId(kitId: any) {
    this._kitId = kitId;
  }
  _kitId = -1;

  @ViewChild(AppGridDirective) grid: AppGridDirective;
  dtOptions: DataTables.Settings = {};
  sub: Subscription;
  table: any;
  total: number;
  selections = {};
  selected = [];
  entities = [];
  /**
   * Every revision the server returned, before collateral is filtered out. `entities` is what the
   * table renders; this is what the count in the notice is measured against, and what comes back
   * when the reader asks to see everything.
   */
  allEntities = [];
  hiddenCollateral = 0;
  showCollateral = false;
  form: UntypedFormGroup = new UntypedFormGroup({});
  model = {};
  ages = {
     0: 'I don\'t know',
     1: 'Less than a year',
     2: '1 - 2 years',
     4: '3 - 4 years',
     5: '5 - 6 years',
     6: 'more than 6 years old'
  };

  classes = {
    'LOGISTICS': 'dark',
    'TECHNICIAN': 'info',
    'ORGANISER': 'success'
  };

  statusTypes: any = KIT_STATUS;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'kit-audit-component';

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
    const queryRef = this.apollo.watchQuery({
      query: QUERY_ENTITY,
      variables: { id: this._kitId },
    });

    this.sub = this.search$.subscribe((query) => {
      if (this.table) {
        this.table.search(query);
        this.table.ajax.reload(null, false);
      }
    });

    this.dtOptions = {
      // dom:
      //   '<\'row\'<\'col-sm-12 col-md-6\'l><\'col-sm-12 col-md-6\'f>>' +
      //   '<\'row\'<\'col-sm-12\'tr>>' +
      //   '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
      //order: [1, 'desc'],
      ordering: false,
      info: false,
      paging: false,
      serverSide: true,
      stateSave: true,
      processing: true,
      searching: false,
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
          id: this._kitId
        };

        queryRef.refetch(vars).then(
          (res) => {
            let data: any = {};
            if (res.data) {
              data = res['data']['kitAudits'];
              if (!this.total) {
                this.total = 10;
              }
              this.allEntities = data;
              this.applyCollateralFilter();

            }

            callback({
              draw: params.draw,
              recordsTotal: this.total,
              recordsFiltered: data.length || 0,
              error: '',
              data: [],
            });
          },
          (err) => {
            callback({
              draw: params.draw,
              recordsTotal: this.total || 0,
              recordsFiltered: 0,
              error: err.message,
              data: [],
            });

            this.toastr.warning(
              `
            <small>${err.message}</small>
          `,
              'GraphQL Error',
              {
                enableHtml: true,
                timeOut: 15000,
                disableTimeOut: true,
              }
            );
          }
        );
      },
    };
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  /**
   * Hides revisions where a device was rewritten without anything about it changing, because it
   * was a sibling in someone else's transaction (#148, fixed 2026-08-13). 83,179 such rows exist
   * in production and they arrived in bursts of up to 2,927, so a device's real history can be
   * buried under dozens of identical entries.
   *
   * BOTH conditions are required. `changedNothingAudited` on its own also matches a genuine edit
   * to the device's attributes — notes, state, credentials, network — which is @NotAudited and so
   * has nothing to show in this table either. Those are real work by real people and hiding them
   * would be a regression; only collateral arrives with siblings.
   *
   * Nothing is deleted and nothing is hidden from the server: the notice states the count and the
   * reader can show them.
   */
  applyCollateralFilter() {
    const collateral = (r: any) => r.changedNothingAudited && r.siblingKitsInRevision > 0;
    this.hiddenCollateral = this.allEntities.filter(collateral).length;
    this.entities = this.showCollateral
      ? this.allEntities
      : this.allEntities.filter((r) => !collateral(r));
  }

  toggleCollateral() {
    this.showCollateral = !this.showCollateral;
    this.applyCollateralFilter();
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
