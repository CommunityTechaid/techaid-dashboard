import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { NgbModal, NgbProgressbar } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo, QueryRef } from 'apollo-angular';
import { FormGroup } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig } from '@ngx-formly/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UpdateFormDirty } from '@ngxs/form-plugin';
import { Select } from '@ngxs/store';
import { AuthenticationService } from '@app/shared/services/authentication.service';
import { User, UserState } from '@app/state/user/user.state';
import { KIT_STATUS } from '../kit-info/kit-info.component';
import { NativeTableComponent, NativeTableRowDirective } from '@app/shared/modules/native-table/native-table.component';
import { TableColumn, clientSource } from '@app/shared/modules/native-table/table-types';
import { PostIndexComponent } from '../post-index/post-index.component';

const QUERY_ENTITY = gql`
query findAll {
  kits: kitsConnection(where: {
    archived: {_neq: true}
  }) {
    totalElements
  }
  donors: donorsConnection(where: {}) {
    totalElements
  }
  typeCount {
    type
    count
  }
  statusCount {
    status
    count
  }
  requestCount {
    LAPTOP: laptops
    TABLET: tablets
    OTHER: other
    SMARTPHONE: phones
    ALLINONE: allInOnes
    DESKTOP: desktops
    COMMSDEVICE: commsDevices
    BROADBANDHUB: broadbandHubs
  }
}
`;


@Component({
    selector: 'dashboard-index',
    styleUrls: ['dashboard-index.scss'],
    templateUrl: './dashboard-index.html',
    // OnPush: model and user are signals, so the page repaints with no zone.js (#115). It was
    // Eager and only repainted because zone.js re-checked it after the findAll promise.
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NgbProgressbar, NativeTableComponent, NativeTableRowDirective, PostIndexComponent]
})
export class DashboardIndexComponent implements OnInit, OnDestroy {
  sub: Subscription;
  readonly model = signal<any>(undefined);
  readonly user = signal<User | undefined>(undefined);
  @Select(UserState.user) user$: Observable<User>;

  constructor(
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private apollo: Apollo,
    private auth: AuthenticationService
  ) { }

  styles = {
    'LAPTOP': {title: 'Laptops', style: 'primary', progress: 0},
    'DESKTOP': {title: 'Desktops', style: 'primary', progress: 0},
    'TABLET': {title: 'Tablets', style: 'info', progress: 0},
    'OTHER': {title: 'Other', style: 'danger', progress: 0},
    'SMARTPHONE': {title: 'Phones', style: 'warning', progress: 0},
    'ALLINONE': {title: 'All In One\'s', style: 'success', progress: 0},
    'COMMSDEVICE': {title: 'SIM Cards', style: 'success', progress: 0},
    'BROADBANDHUB': {title: 'Broadband Hubs', style: 'success', progress: 0}
  };

  kitStatus = KIT_STATUS;

  /**
   * The status table is client-side: 5 rows a page, a search box, header sort (status, then
   * count), no length menu and no saved state, as it was under DataTables. The rows are the
   * findAll `statusCount` entries with their display label; the source reads them per request.
   */
  readonly statusRows = computed(() =>
    (this.model()?.statusCount ?? []).map((s: any) => ({ status: s.status, label: this.kitStatus[s.status] || s.status, count: s.count })));
  readonly statusColumns: TableColumn[] = [
    { title: 'Status', key: 'label' },
    { title: 'Count', key: 'count' },
  ];
  readonly statusSource = clientSource<any>(() => this.statusRows(), {
    label: r => r.label,
    count: r => r.count,
  });

  // Created lazily: four of findAll's five fields are @PreAuthorize'd server-side, so building
  // the query before a token exists just buys an Access Denied round trip and a server WARN.
  private queryRef: QueryRef<any>;

  private normalizeData(data: any) {
    (data.typeCount || []).forEach(s => {
      let p = (data.requestCount[s.type] / s.count) * 100;
      if (p > 100) {
        p = 100;
      }
      this.styles[s.type].progress = p;
    });
    return data;
  }

  private fetchData(vars) {
    if (!this.queryRef) {
      this.queryRef = this.apollo.watchQuery({
        query: QUERY_ENTITY,
        variables: vars
      });
    }
    this.queryRef.refetch(vars).then(res => {
      if (res.data) {
        this.model.set(this.normalizeData(res.data));
      } else {
        this.model.set({});
      }
    });
  }

  ngOnInit() {
    this.sub = this.user$.subscribe(user => {
        this.user.set(user);
    });

    // Hold findAll until a token exists — four of its five fields are @PreAuthorize'd and
    // throw Access Denied without one. Waiting for the first *authenticated* emission rather
    // than sampling isAuthenticated$ is the whole trick.
    //
    // No isLoading$ gate is needed here: @auth0/auth0-angular v2 derives isAuthenticated$
    // from isLoading$ internally ("there is no need to manually check the loading state of
    // the SDK" — auth.state.ts), so it cannot emit before the cached session has been read.
    // The gate in auth.guard.ts predates the v2 migration and is a no-op; don't copy it.
    this.sub.add(
      this.auth.isAuthenticated$.pipe(
        filter(isAuthenticated => isAuthenticated),
        take(1)
      ).subscribe(() => this.fetchData({}))
    );
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}
