import { Injectable, afterNextRender } from '@angular/core';
// Type-only: the SDK itself (~240 kB) is loaded with a dynamic import() so it lands in its own
// lazy chunk instead of the eagerly-loaded main bundle.
import type { ApplicationInsights, IExceptionTelemetry } from '@microsoft/applicationinsights-web';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

declare const window: Window & { __env?: { appInsightsConnectionString?: string } };

type Telemetry = (ai: ApplicationInsights) => void;

/** Upper bound on calls buffered while the SDK loads, so a stuck import cannot grow without limit. */
const MAX_PENDING = 100;

/**
 * Application Insights, loaded lazily.
 *
 * The SDK is only fetched when `window.__env.appInsightsConnectionString` is set (deploy-time
 * `assets/env.js`), and only once the first render is done and the browser is idle. Page views and
 * exceptions that happen before it is ready are buffered and sent once it loads, so the first
 * navigation is still tracked. A failed import is logged and telemetry is dropped; it never breaks
 * the app.
 */
@Injectable({ providedIn: 'root' })
export class AppInsightsService {
  private appInsights: ApplicationInsights | null = null;
  private pending: Telemetry[] | null = null;

  constructor(private router: Router) {
    const connectionString = window.__env?.appInsightsConnectionString;
    if (!connectionString) {
      return;
    }
    this.pending = [];

    // Subscribe now, not when the SDK arrives, so the first NavigationEnd is not missed.
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.send(ai => ai.trackPageView({ uri: event.urlAfterRedirects }));
    });

    afterNextRender(() => whenIdle(() => this.load(connectionString)));
  }

  trackException(error: Error): void {
    const exception: IExceptionTelemetry = { exception: error };
    this.send(ai => ai.trackException(exception));
  }

  private send(call: Telemetry): void {
    if (this.appInsights) {
      call(this.appInsights);
    } else if (this.pending && this.pending.length < MAX_PENDING) {
      this.pending.push(call);
    }
  }

  private async load(connectionString: string): Promise<void> {
    try {
      const { ApplicationInsights } = await import('@microsoft/applicationinsights-web');
      const ai = new ApplicationInsights({
        config: { connectionString, enableAutoRouteTracking: false }
      });
      ai.loadAppInsights();
      this.appInsights = ai;
      const queued = this.pending ?? [];
      this.pending = null;
      queued.forEach(call => call(ai));
    } catch (err) {
      this.pending = null;
      console.warn('Application Insights failed to load; telemetry is disabled for this session.', err);
    }
  }
}

/** requestIdleCallback where available (not Safari), otherwise a short timeout. */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(task, { timeout: 3000 });
  } else {
    setTimeout(task, 200);
  }
}
