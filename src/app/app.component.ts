import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { ActivatedRoute, Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { RouterNavigation } from '@ngxs/router-plugin';
import { Store, Actions, ofAction } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { APP_VERSION } from '@env/version';
import { Title } from '@angular/platform-browser';
import { filter, map } from "rxjs/operators";
import { AppInsightsService } from '@app/shared/services/app-insights.service';
import { ConfigService } from '@app/shared/services/config.service';
import { NgProgressbar } from 'ngx-progressbar';
import { NgProgressRouter } from 'ngx-progressbar/router';
import { NgProgressHttp } from 'ngx-progressbar/http';
import { AppSidebar } from './components/app-sidebar/app.sidebar.component';
import { AppHeader } from './components/app-header/app.header.component';
import { BackendStatusService, BackendStatus } from '@app/shared/services/backend-status.service';
import { AuthenticationService } from '@app/shared/services/authentication.service';
import { LayoutService } from '@app/shared/services/layout.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [NgProgressbar, NgProgressRouter, NgProgressHttp, AppSidebar, AppHeader, RouterOutlet]
})
export class AppComponent implements OnInit, OnDestroy {
  private actionSub: Subscription;
  version = APP_VERSION;
  apiVersion = '';
  backendStatus: BackendStatus = 'checking';
  authLoading = true;
  showInterstitial = false;
  private interstitialTimer: any;
  private readonly INTERSTITIAL_GRACE_MS = 1000;
  // Fields below are written from subscriptions and a timer: mark for check so they repaint without zone.js (#115).
  private readonly cdr = inject(ChangeDetectorRef);

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
    private authService: AuthenticationService,
    private layout: LayoutService
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
    this.layout.init();
    this.actionSub = this.actions.pipe(ofAction(RouterNavigation)).subscribe(({ event }) => this.handleAction(event));

    this.actionSub.add(
      this.authService.isLoading$.subscribe(loading => {
        this.authLoading = loading;
        this.updateInterstitial();
        this.cdr.markForCheck();
      })
    );

    this.actionSub.add(
      this.backendStatusService.status$.subscribe(status => {
        this.backendStatus = status;
        this.updateInterstitial();
        this.cdr.markForCheck();
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
        this.cdr.markForCheck();
      })
    );

    this.backendStatusService.startCheck();
  }

  scrollToTop(event: Event) {
    event.preventDefault();
    this.layout.scrollToTop();
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
    clearTimeout(this.interstitialTimer);
    this.backendStatusService.cleanup();
  }

  private updateInterstitial() {
    const loading = this.authLoading || this.backendStatus === 'checking';
    if (loading) {
      if (!this.showInterstitial && !this.interstitialTimer) {
        this.interstitialTimer = setTimeout(() => {
          this.interstitialTimer = null;
          this.showInterstitial = true;
          this.cdr.markForCheck();
        }, this.INTERSTITIAL_GRACE_MS);
      }
    } else {
      clearTimeout(this.interstitialTimer);
      this.interstitialTimer = null;
      this.showInterstitial = false;
    }
  }

}
