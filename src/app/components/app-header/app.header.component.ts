import { Select, Store } from '@ngxs/store';
import { UserStateModel, UserState, User } from '@app/state/user/user.state';
import { LogoutUser, LoginUser } from '@app/state/user/actions/user.actions';
import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { concat, Subject, of, forkJoin, Observable, Subscription, from } from 'rxjs';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { Apollo } from 'apollo-angular';
import { SearchQuery } from '@views/corewidgets/state/actions';
import $ from 'jquery';
import { environment } from '@env/environment';

import { AppInitialComponent } from '../../shared/components/app-initial/app-initial.component';
import { RouterLink, RouterLinkActive } from '@angular/router';


@Component({
    selector: 'app-header',
    templateUrl: 'app.header.component.html',
    styles: [`
        .nav-border {
            border-bottom: 1px solid #f8f9fa;
        }
        .testing-banner {
            background-color: #fd7e14;
            color: #fff;
            font-size: 0.875rem;
            letter-spacing: 0.05em;
        }
    `],
    imports: [AppInitialComponent, RouterLink, RouterLinkActive]
})
export class AppHeader {
    private sub: Subscription;
    apis$: Observable<any>;
    public user: User;
    readonly isTestEnvironment =
        environment.environment !== 'production' ||
        window.location.hostname === 'app-testing.communitytechaid.org.uk';
    @Select(UserState.user) user$: Observable<User>;
    constructor(
        private store: Store,
        private toastr: ToastrService,
        private modalService: NgbModal,
        private apollo: Apollo) { }

    modal(content) {
        this.modalService.open(content, { centered: true });
    }

    toggleSideBar() {
        $('body').toggleClass('sidebar-toggled');
    }

    ngOnInit() {
        this.sub = this.user$.subscribe(user => {
            this.user = user;
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
