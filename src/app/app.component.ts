import { Component } from '@angular/core';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { RouterNavigation } from '@ngxs/router-plugin';
import { Store, Actions, ofAction } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { APP_VERSION } from '@env/version';
import { Title } from '@angular/platform-browser';
import { filter, map } from "rxjs/operators";
import { AppInsightsService } from '@app/shared/services/app-insights.service';
import { ConfigService } from '@app/shared/services/config.service';
import { NgZone } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  private actionSub: Subscription;
  version = APP_VERSION;
  apiVersion = '';
  constructor(
    private toastr: ToastrService,
    private store: Store,
    private actions: Actions,
    private titleService: Title,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private appInsights: AppInsightsService,
    private config: ConfigService,
    private zone: NgZone
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
    this.fetchBuildInfo();
  }

  private fetchBuildInfo() {
    const endpoint = this.config.environment.graphql_endpoint;
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ buildInfo { version commit time } }' })
    })
      .then(res => res.json())
      .then(res => {
        this.zone.run(() => {
          if (res && res.data && res.data.buildInfo) {
            const info = res.data.buildInfo;
            const time = info.time ? ' ' + info.time.replace(/T.*/, '') : '';
            this.apiVersion = `${info.version} (${info.commit})${time}`;
          } else {
            this.apiVersion = 'unavailable';
          }
        });
      })
      .catch(err => {
        console.warn('Failed to fetch buildInfo:', err);
        this.zone.run(() => {
          this.apiVersion = 'unavailable';
        });
      });
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
  }

}
