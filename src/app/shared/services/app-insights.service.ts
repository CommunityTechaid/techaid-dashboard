import { Injectable } from '@angular/core';
import { ApplicationInsights, IExceptionTelemetry } from '@microsoft/applicationinsights-web';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

declare const window: Window & { __env?: { appInsightsConnectionString?: string } };

@Injectable({ providedIn: 'root' })
export class AppInsightsService {
  private appInsights: ApplicationInsights | null = null;

  constructor(private router: Router) {
    const connectionString = window.__env?.appInsightsConnectionString;
    if (!connectionString) {
      return;
    }

    this.appInsights = new ApplicationInsights({
      config: { connectionString, enableAutoRouteTracking: false }
    });
    this.appInsights.loadAppInsights();

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.appInsights.trackPageView({ uri: event.urlAfterRedirects });
    });
  }

  trackException(error: Error): void {
    if (!this.appInsights) { return; }
    const exception: IExceptionTelemetry = { exception: error };
    this.appInsights.trackException(exception);
  }
}
