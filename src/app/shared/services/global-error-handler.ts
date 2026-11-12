import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { AppInsightsService } from './app-insights.service';

/** Upper bound per page load, so an error thrown on every repaint cannot flood Azure. */
const MAX_REPORTED = 50;

/**
 * Sends the errors Angular catches to Application Insights.
 *
 * WHY: Angular catches errors thrown in templates, event handlers, lifecycle hooks and failed
 * navigations and hands them to ErrorHandler, whose default only logs to the console. They never
 * reach window.onerror, so the App Insights SDK's own collection never saw them: in 90 days of
 * production (to 2026-11-12) Azure held 38 browser exceptions, none from inside Angular.
 *
 * The console.error is kept (it is what the default handler does, and what developers and the
 * e2e CSP fixture read). Reporting must never throw: an error raised here would recurse.
 *
 * AppInsightsService is resolved on first use, not injected in the constructor, because it
 * depends on Router, which itself asks for ErrorHandler.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);
  private reported = 0;

  handleError(error: unknown): void {
    console.error('ERROR', error);
    if (this.reported >= MAX_REPORTED) {
      return;
    }
    this.reported++;
    try {
      const exception = error instanceof Error ? error : new Error(describe(error));
      this.injector.get(AppInsightsService).trackException(exception, {
        source: 'angular-error-handler',
        route: location.pathname,
      });
    } catch (reportingError) {
      console.warn('Could not report an error to Application Insights', reportingError);
    }
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
