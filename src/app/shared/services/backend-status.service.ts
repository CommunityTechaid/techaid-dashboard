import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ConfigService } from './config.service';

export type BackendStatus = 'checking' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class BackendStatusService {
  private readonly POLL_INTERVAL_MS = 4000;
  private readonly MAX_ATTEMPTS = 15;

  private attempt = 0;
  private pollTimer: any;
  private abortController: AbortController | null = null;

  /** Emits 'checking' on start, 'ready' on first success, 'error' after MAX_ATTEMPTS failures. */
  readonly status$ = new BehaviorSubject<BackendStatus>('checking');

  /**
   * The parsed buildInfo from the last successful probe.
   * AppComponent uses this to populate the version footer without a second round-trip.
   */
  readonly buildInfo$ = new BehaviorSubject<{ version: string; commit: string; time: string } | null>(null);

  constructor(private zone: NgZone, private config: ConfigService) {}

  /** User-facing message that progresses as attempts accumulate. */
  get statusMessage(): string {
    if (this.attempt < 3) return 'Starting up… this usually takes about 30 seconds.';
    if (this.attempt < 8) return 'Still warming up… almost there.';
    return 'Taking a bit longer than usual, please hang on…';
  }

  /** Start (or restart) the health-check poll cycle from scratch. */
  startCheck() {
    this.cleanup();
    this.attempt = 0;
    this.status$.next('checking');
    this.poll();
  }

  private poll() {
    this.abortController = new AbortController();
    const endpoint = this.config.environment.graphql_endpoint;

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ buildInfo { version commit time } }' }),
      signal: this.abortController.signal
    })
      .then(res => res.json())
      .then(res => {
        this.zone.run(() => {
          if (res?.data?.buildInfo) {
            this.buildInfo$.next(res.data.buildInfo);
            this.status$.next('ready');
          } else {
            this.scheduleRetry();
          }
        });
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        this.zone.run(() => this.scheduleRetry());
      });
  }

  private scheduleRetry() {
    this.attempt++;
    if (this.attempt >= this.MAX_ATTEMPTS) {
      this.status$.next('error');
      return;
    }
    this.pollTimer = setTimeout(() => this.poll(), this.POLL_INTERVAL_MS);
  }

  /** Cancel any pending poll timer and in-flight fetch. Safe to call multiple times. */
  cleanup() {
    clearTimeout(this.pollTimer);
    this.abortController?.abort();
    this.abortController = null;
  }
}
