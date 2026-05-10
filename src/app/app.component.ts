import { Component } from '@angular/core';
import { ActivatedRoute, Router, NavigationEnd, RouterOutlet, RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { RouterNavigation } from '@ngxs/router-plugin';
import { Store, Actions, ofAction } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { APP_VERSION } from '@env/version';
import { Title } from '@angular/platform-browser';
import { filter, map } from "rxjs/operators";
import { AppInsightsService } from '@app/shared/services/app-insights.service';
import { ConfigService } from '@app/shared/services/config.service';
import { NgProgressComponent } from 'ngx-progressbar';
import { AppSidebar } from './components/app-sidebar/app.sidebar.component';
import { AppHeader } from './components/app-header/app.header.component';
import { BackendStatusService, BackendStatus } from '@app/shared/services/backend-status.service';
import { AuthenticationService } from '@app/shared/services/authentication.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    imports: [NgProgressComponent, AppSidebar, AppHeader, RouterOutlet, RouterLink]
})
export class AppComponent {
  private actionSub: Subscription;
  version = APP_VERSION;
  apiVersion = '';
  backendStatus: BackendStatus = 'checking';
  authLoading = true;

  constructor(
    private toastr: ToastrService,
    private store: Store,
    private actions: Actions,
    private titleService: Title,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private appInsights: AppInsightsService,
    private config: ConfigService,
    readonly backendStatusService: BackendStatusService,
    private authService: AuthenticationService
  ) {
    titleService.setTitle("TaDa");

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => {
          let child = this.activatedRoute.firstChild;
          while (child) {
              if (child.firstChild) {
                  child = child.firstChild;
              } else if (child.snapshot.data && child.snapshot.data['title']) {
                  return child.snapshot.data['title'];
              } else {
                  return null;
              }
          }
          return null;
      })
    ).subscribe( (data: any) => {
        if (data) {
            this.titleService.setTitle('TaDa - ' + data);
        }
    });
  }

  ngOnInit() {
    this.actionSub = this.actions.pipe(ofAction(RouterNavigation)).subscribe(({ event }) => this.handleAction(event));

    this.actionSub.add(
      this.authService.isLoading$.subscribe(loading => {
        this.authLoading = loading;
      })
    );

    this.actionSub.add(
      this.backendStatusService.status$.subscribe(status => {
        this.backendStatus = status;
      })
    );

    this.actionSub.add(
      this.backendStatusService.buildInfo$.subscribe(info => {
        if (info) {
          const time = info.time ? ' ' + info.time.replace(/T.*/, '') : '';
          this.apiVersion = `${info.version} (${info.commit})${time}`;
        } else if (this.backendStatus === 'error') {
          this.apiVersion = 'unavailable';
        }
      })
    );

    this.backendStatusService.startCheck();
  }

  handleAction(action) {
    if (action.state && action.state.root && action.state.root.queryParams.advanced) {
      const html = `
        <small>
          <p>We trust you have received the usual lecture from the System Administrator.</p>
          <hr />
          <p>With great power comes great responsibility</p>
        </small>
      `;
      this.toastr.warning(html, 'Advanced Mode Activated', {
        enableHtml: true,
        timeOut: 15000
      });
    }
  }

  ngOnDestroy() {
    if (this.actionSub) {
      this.actionSub.unsubscribe();
    }
    this.backendStatusService.cleanup();
  }

}
