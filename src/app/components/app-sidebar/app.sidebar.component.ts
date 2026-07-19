import { Component, OnInit, OnDestroy } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { UserStateModel, UserState, User } from '@app/state/user/user.state';
import { LogoutUser, LoginUser } from '@app/state/user/actions/user.actions';
import { Observable, Subscription } from 'rxjs';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { environment } from '@env/environment';

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
    /** Prototype prep-mode UI is gated by the per-env feature flag (off in prod). */
    prepModeEnabled = !!environment.feature_prep_mode;
    public user: User;
    private sub: Subscription;
    @Select(UserState.user) user$: Observable<User>;


    constructor(private store: Store) { }
    ngOnInit() {
        this.sub = this.user$.subscribe(user => {
            this.user = user;
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
