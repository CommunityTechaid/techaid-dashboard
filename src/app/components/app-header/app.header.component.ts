import { Select, Store } from '@ngxs/store';
import { UserStateModel, UserState, User } from '@app/state/user/user.state';
import { LogoutUser, LoginUser } from '@app/state/user/actions/user.actions';
import { Component, ViewChild, ViewEncapsulation, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { Apollo } from 'apollo-angular';
import { SearchQuery } from '@views/corewidgets/state/actions';
import { environment } from '@env/environment';

import { AppInitialComponent } from '../../shared/components/app-initial/app-initial.component';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgbDropdown, NgbDropdownToggle, NgbDropdownMenu } from '@ng-bootstrap/ng-bootstrap';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';
import { LayoutService } from '@app/shared/services/layout.service';


@Component({
    selector: 'app-header',
    templateUrl: 'app.header.component.html',
    styles: [`
        .nav-border {
            border-bottom: 1px solid #f8f9fa;
        }
    `],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [AppInitialComponent, RouterLink, RouterLinkActive, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu]
})
export class AppHeader implements OnInit, OnDestroy {
    private sub: Subscription;
    apis$: Observable<any>;
    public user: User;
    readonly isTestEnvironment =
        environment.environment !== 'production' ||
        window.location.hostname === 'app-testing.communitytechaid.org.uk';
    deliveryBookingVisible = false;
    @Select(UserState.user) user$: Observable<User>;
    private readonly cdr = inject(ChangeDetectorRef);
    constructor(
        private store: Store,
        private toastr: ToastrService,
        private modalService: NgbModal,
        private apollo: Apollo,
        private featureFlags: FeatureFlagService,
        private layout: LayoutService) { }

    modal(content) {
        this.modalService.open(content, { centered: true });
    }

    toggleSideBar() {
        this.layout.toggleSidebar();
    }

    ngOnInit() {
        this.sub = this.user$.subscribe(user => {
            this.user = user;
            this.cdr.markForCheck();
        });
        this.featureFlags.deliveryBookingVisibility().subscribe(state => {
            this.deliveryBookingVisible = state.visible;
            this.cdr.markForCheck();
        });
    }

    postSearch(text: string) {
        this.store.dispatch(new SearchQuery(text));
    }

    clearCache() {
        localStorage.clear();
        window.location.reload();
        return false;
    }

    ngOnDestroy() {
        if (this.sub) {
            this.sub.unsubscribe();
        }
    }

    logout() {
        this.store.dispatch(new LogoutUser());
    }

    login() {
        this.store.dispatch(new LoginUser());
        return false;
    }
}
