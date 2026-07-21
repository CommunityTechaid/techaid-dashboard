import { Injectable, signal } from '@angular/core';
import { parseScan, ScanEvent } from './scan-parser';

/**
 * Per-mode behaviour for a scan session. This is the seam: "prep mode" and the
 * later "OS-install mode" each supply their own strategy; the session and the
 * input component stay mode-agnostic.
 *
 * Handlers may be sync or async — the session does not await them (a scanner can
 * fire the next scan before the previous one resolves), so a strategy that needs
 * ordering must serialise internally.
 */
export interface ScanModeStrategy {
  handleKitId(id: number, raw: string): void | Promise<void>;
  handleAction(code: string, raw: string): void | Promise<void>;
  /** Optional: called for scans that matched no known pattern. */
  handleUnknown?(raw: string): void;
}

/** How many recent scans to keep for the operator's visual-verification list. */
const DEFAULT_HISTORY_LIMIT = 8;

/**
 * Owns a single scan session: parses each raw scan, dispatches it to the active
 * {@link ScanModeStrategy}, and exposes signals for the UI (last scan + a small
 * rolling history so mis-scans are visible — see techaid-server#66).
 *
 * Component-provided (NOT root-provided): each scan page owns its own session, so
 * provide this in the hosting component's `providers`, not `providedIn: 'root'`.
 */
@Injectable()
export class ScanSession {
  private readonly _lastScan = signal<ScanEvent | null>(null);
  private readonly _history = signal<ScanEvent[]>([]);

  /** The most recently parsed scan, or null before the first scan. */
  readonly lastScan = this._lastScan.asReadonly();

  /** Rolling list of recent scans, newest first, capped at `historyLimit`. */
  readonly history = this._history.asReadonly();

  private strategy: ScanModeStrategy | null = null;

  /**
   * Max recent scans kept in {@link history}. Defaults to {@link DEFAULT_HISTORY_LIMIT};
   * set it before the first scan if a mode wants a longer/shorter tail. Not a
   * constructor arg so the class stays DI-friendly as a component-provided service.
   */
  historyLimit = DEFAULT_HISTORY_LIMIT;

  /** Set (or replace) the active mode strategy. */
  setStrategy(strategy: ScanModeStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Parse a raw scan and dispatch it. Returns the parsed event so callers can
   * react without re-reading a signal. Blank input is ignored (returns null).
   */
  submit(raw: string): ScanEvent | null {
    if (!raw.trim()) {
      return null;
    }

    const event = parseScan(raw);
    this._lastScan.set(event);
    this._history.update((prev) => [event, ...prev].slice(0, this.historyLimit));
    this.dispatch(event);
    return event;
  }

  /** Dispatch an already-parsed event (used by components that emit ScanEvents). */
  dispatch(event: ScanEvent): void {
    const strategy = this.strategy;
    if (!strategy) {
      return;
    }
    switch (event.kind) {
      case 'kit-id':
        void strategy.handleKitId(event.id, event.raw);
        break;
      case 'action':
        void strategy.handleAction(event.code, event.raw);
        break;
      case 'unknown':
        strategy.handleUnknown?.(event.raw);
        break;
    }
  }

  /** Clear last-scan and history (e.g. when starting a fresh batch). */
  reset(): void {
    this._lastScan.set(null);
    this._history.set([]);
  }
}
