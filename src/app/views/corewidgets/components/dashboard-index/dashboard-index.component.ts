import { Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { AppGridDirective } from '@app/shared/modules/grid/app-grid.directive';
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
import { AppGridDirective as AppGridDirective_1 } from '../../../../shared/modules/grid/app-grid.directive';
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
    imports: [NgbProgressbar, AppGridDirective_1, PostIndexComponent]
})
export class DashboardIndexComponent implements OnInit, OnDestroy {
  sub: Subscription;
  model: any;
  user: User;
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

  dtOptions = {
    pageLength: 5,
    dom: '<\'row\'<\'col-sm-12 col-md-6\'><\'col-sm-12 col-md-6\'f>>' +
          '<\'row\'<\'col-sm-12\'tr>>' +
          '<\'row\'<\'col-sm-12 col-md-5\'i><\'col-sm-12 col-md-7\'p>>',
  };

  kitStatus = KIT_STATUS;

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
        this.model = this.normalizeData(res.data);
      } else {
        this.model = {};
      }
    });
  }

  ngOnInit() {
    this.sub = this.user$.subscribe(user => {
        this.user = user;
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
