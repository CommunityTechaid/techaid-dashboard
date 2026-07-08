import { Component, OnInit, OnDestroy } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { UserStateModel, UserState, User } from '@app/state/user/user.state';
import { LogoutUser, LoginUser } from '@app/state/user/actions/user.actions';
import { Observable, Subscription } from 'rxjs';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { FeatureFlagService } from '@app/shared/services/feature-flag.service';

@Component({
    selector: 'app-sidebar',
    templateUrl: 'app.sidebar.component.html',
    styles: [`
        .logo {
          content: url('https://static.wixstatic.com/media/827819_a9d9035b121c43d580740403221ef28f~mv2.png');
          width: 75px;
          padding-top: 5px;
        }
    `],
    imports: [RouterLink, RouterLinkActive]
})

export class AppSidebar implements OnInit, OnDestroy {
    sidebar = true;
    public user: User;
    deliveryBookingVisible = false;
    private sub: Subscription;
    @Select(UserState.user) user$: Observable<User>;


    constructor(private store: Store, private featureFlags: FeatureFlagService) { }
    ngOnInit() {
        this.sub = this.user$.subscribe(user => {
            this.user = user;
        });
        this.featureFlags.deliveryBookingVisibility().subscribe(state => {
            this.deliveryBookingVisible = state.visible;
        });
    }


    ngOnDestroy() {
        if (this.sub) {
            this.sub.unsubscribe();
        }
    }

    logout() {
        this.store.dispatch(new LogoutUser());
        return false;
    }

    login() {
        this.store.dispatch(new LoginUser());
        return false;
    }
}
