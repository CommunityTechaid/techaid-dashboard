import { AfterViewInit, Component, ElementRef, OnInit, computed, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ToastrService } from 'ngx-toastr';
import { ScanModeStrategy, ScanSession } from '../scan/scan-session';
import { KIT_STATUS } from '../kit-info/kit-info.component';
import { KitScannerApiService, ScannerKit } from './kit-scanner-api.service';

/**
 * A mode the scanner can be armed with. `code` is the payload on the printed
 * Code 128 mode card (`CTA*` + code), `key` the `KitStatus` enum applied to each
 * scanned device, `label` the operator-facing name — taken from KIT_STATUS so
 * the scanner can never drift from the rest of the app's status vocabulary.
 */
export interface ScannerMode {
  key: string;
  code: string;
  label: string;
  /** Short name used in the end-of-session summary line. */
  short: string;
  /** Palette class suffix; see kit-scanner.component.scss. */
  tone: 'os' | 'qc' | 'assess';
}

export const SCANNER_MODES: ScannerMode[] = [
  { key: 'PROCESSING_OS_INSTALLED', code: 'OS-INSTALLED', label: KIT_STATUS['PROCESSING_OS_INSTALLED'], short: 'OS', tone: 'os' },
  { key: 'ALLOCATION_QC_COMPLETED', code: 'QC-COMPLETE', label: KIT_STATUS['ALLOCATION_QC_COMPLETED'], short: 'QC', tone: 'qc' },
  { key: 'ALLOCATION_READY', code: 'ASSESS-CHECK', label: KIT_STATUS['ALLOCATION_READY'], short: 'assessment', tone: 'assess' },
];

/** Mode-card payload that clears the armed mode. */
const DISARM_CODE = 'DISARM';

/**
 * Statuses `kit-info` refuses to let a flagged device hold. The scanner honours
 * the same rule for the two it can arm — and it is the ONLY thing enforcing it:
 * `updateKits` applies the status server-side with no sub-status validation
 * (techaid-server KitMutations.kt). Removing this check silently re-opens the
 * hole for every scan.
 */
const FLAG_BLOCKED_STATUSES = ['ALLOCATION_QC_COMPLETED', 'ALLOCATION_READY'];

/** The sub-status flags that block those statuses. Mirrors kit-info. */
const BLOCKING_FLAGS = [
  'wipeFailed',
  'installationOfOSFailed',
  'needsFurtherInvestigation',
  'needsSparePart',
  'lockedToUser',
] as const;

type BannerKind = 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface Banner {
  kind: BannerKind;
  /** Uppercase kicker above the message. */
  kicker: string;
  text: string;
}

interface LastResult {
  id: number;
  description: string;
  currentStatus: string;
}

@Component({
  selector: 'app-kit-scanner',
  standalone: true,
  imports: [RouterLink, DatePipe],
  providers: [ScanSession, KitScannerApiService],
  templateUrl: './kit-scanner.component.html',
  styleUrls: ['./kit-scanner.component.scss'],
})
export class KitScannerComponent implements OnInit, AfterViewInit, ScanModeStrategy {
  readonly modes = SCANNER_MODES;

  /** The armed mode, or null when idle. Idle is a valid resting state. */
  readonly armed = signal<ScannerMode | null>(null);

  /** In-flight guard: while true, incoming SCANS are refused (not clicks). */
  readonly busy = signal(false);

  readonly banner = signal<Banner>(IDLE_BANNER);

  /** Confirming context for the device currently being (or last) applied. */
  readonly lastResult = signal<LastResult | null>(null);

  /** Per-mode session tally, keyed by KitStatus. */
  readonly tally = signal<Record<string, number>>({});

  readonly sessionStarted = new Date();

  readonly total = computed(() =>
    Object.values(this.tally()).reduce((sum, n) => sum + n, 0),
  );

  /** `Session complete — …` line, shown once anything has been applied. */
  readonly sessionSummary = computed(() => {
    const counts = this.tally();
    const parts = this.modes.map(m => `${counts[m.key] ?? 0} ${m.short}`).join(' · ');
    return `Session complete — ${this.total()} updated. ${parts}.`;
  });

  /**
   * Devices already handled this session, so a re-scan is reported rather than
   * re-sent. Not a signal — read inside handlers, never rendered directly.
   */
  private readonly seen = new Map<number, { modeKey: string; at: Date }>();

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('scanField');

  constructor(
    readonly session: ScanSession,
    private readonly api: KitScannerApiService,
    private readonly toastr: ToastrService,
    private readonly titleService: Title,
  ) {
    this.titleService.setTitle('TaDa - Update Scanner');
  }

  ngOnInit(): void {
    this.session.setStrategy(this);
  }

  /**
   * Arm the cursor as soon as the page renders, so an operator can walk up and
   * scan without touching the mouse. Done here rather than with the `autofocus`
   * attribute, which the template a11y lint rejects.
   */
  ngAfterViewInit(): void {
    this.focusField();
  }

  // ── Scan input ─────────────────────────────────────────────────────────────

  /** Keyboard-wedge scanners "type" the payload then press Enter. */
  onScan(field: HTMLInputElement): void {
    const raw = field.value;
    field.value = '';
    if (!raw.trim()) {
      return;
    }
    this.session.submit(raw);
    this.focusField();
  }

  /**
   * Return the cursor to the scan field, but never steal it from the operator.
   * A naive refocus-on-blur grabs focus back while someone is typing elsewhere
   * on the page; the guard is that we only reclaim it when this window is
   * actually focused AND nothing else that accepts typing has taken over.
   */
  onBlur(): void {
    setTimeout(() => {
      if (!document.hasFocus()) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== this.field()?.nativeElement && isTypingTarget(active)) {
        return;
      }
      this.focusField();
    }, 40);
  }

  private focusField(): void {
    this.field()?.nativeElement.focus();
  }

  // ── Arming ─────────────────────────────────────────────────────────────────

  /** Dropdown change. `''` (the Disarm option) clears the armed mode. */
  onModeSelect(key: string): void {
    const mode = this.modes.find(m => m.key === key) ?? null;
    this.setMode(mode);
    // A deliberate arm from the dropdown hands the cursor back to the scanner.
    this.focusField();
  }

  armFromCard(mode: ScannerMode): void {
    this.setMode(mode);
    this.focusField();
  }

  disarm(): void {
    this.setMode(null);
    this.focusField();
  }

  private setMode(mode: ScannerMode | null): void {
    this.armed.set(mode);
    this.banner.set(
      mode
        ? {
            kind: 'info',
            kicker: 'Armed',
            text: `Armed: ${mode.label}. Scan devices now — each is set to ${mode.label}.`,
          }
        : { kind: 'neutral', kicker: 'Disarmed', text: 'Disarmed. Scanning paused until you arm a mode.' },
    );
  }

  // ── ScanModeStrategy ───────────────────────────────────────────────────────

  handleAction(code: string, raw: string): void {
    if (this.rejectedAsBusy()) {
      return;
    }
    if (code === DISARM_CODE) {
      this.setMode(null);
      return;
    }
    const mode = this.modes.find(m => m.code === code);
    if (!mode) {
      this.handleUnknown(raw);
      return;
    }
    this.setMode(mode);
  }

  handleKitId(id: number): void {
    // Synchronous guard: set busy BEFORE any await, so a scanner firing again
    // mid-mutation is cleanly refused rather than interleaved.
    if (this.rejectedAsBusy()) {
      return;
    }
    const mode = this.armed();
    if (!mode) {
      this.banner.set(IDLE_BANNER);
      return;
    }
    this.busy.set(true);
    void this.applyToDevice(mode, id).finally(() => {
      this.busy.set(false);
      this.focusField();
    });
  }

  handleUnknown(raw: string): void {
    this.banner.set({
      kind: 'error',
      kicker: 'Not recognised',
      text: `Didn't recognise '${raw}'. Not a device barcode or a mode card.`,
    });
  }

  private rejectedAsBusy(): boolean {
    if (!this.busy()) {
      return false;
    }
    this.banner.set({
      kind: 'warning',
      kicker: 'Busy',
      text: 'Busy — finishing the last scan. That scan was ignored, try again.',
    });
    return true;
  }

  // ── The scan → apply loop ──────────────────────────────────────────────────

  private async applyToDevice(mode: ScannerMode, id: number): Promise<void> {
    const alreadyDone = this.seen.get(id);
    if (alreadyDone && alreadyDone.modeKey === mode.key) {
      this.banner.set({
        kind: 'warning',
        kicker: 'Duplicate',
        text: `#${id} already set to ${mode.label} at ${formatTime(alreadyDone.at)}. No change.`,
      });
      return;
    }

    let kit: ScannerKit | null;
    try {
      kit = await this.api.findKit(id);
    } catch (err) {
      this.reportFailure(`Could not look up #${id}`, err);
      return;
    }

    if (!kit) {
      this.banner.set({
        kind: 'error',
        kicker: 'Not found',
        text: `No device found for #${id}. Check the label and scan again.`,
      });
      return;
    }

    this.lastResult.set({
      id,
      description: describeKit(kit),
      currentStatus: KIT_STATUS[kit.status] ?? kit.status,
    });

    if (kit.archived) {
      this.banner.set({
        kind: 'error',
        kicker: 'Archived',
        text: `#${id} is archived and can't be updated.`,
      });
      return;
    }

    if (kit.status === mode.key) {
      this.banner.set({
        kind: 'info',
        kicker: 'No change',
        text: `#${id} is already ${mode.label}. No change made.`,
      });
      return;
    }

    if (isBlockedByFlag(mode, kit)) {
      this.banner.set({
        kind: 'error',
        kicker: 'Blocked',
        text:
          `#${id} can't move to ${mode.label} — a device flag is set ` +
          '(e.g. needs spare part). Clear it on the device record first.',
      });
      return;
    }

    this.banner.set({
      kind: 'neutral',
      kicker: 'Applying',
      text: `#${id} — applying ${mode.label}…`,
    });

    try {
      await this.api.applyStatus(id, mode.key);
    } catch (err) {
      this.reportFailure(`#${id} was not updated`, err);
      return;
    }

    this.seen.set(id, { modeKey: mode.key, at: new Date() });
    this.tally.update(counts => ({ ...counts, [mode.key]: (counts[mode.key] ?? 0) + 1 }));
    this.lastResult.set({ id, description: describeKit(kit), currentStatus: mode.label });
    this.banner.set({
      kind: 'success',
      kicker: 'Applied',
      text: `#${id} · ${describeKit(kit)} → ${mode.label} ✓`,
    });
  }

  /**
   * Surface a failure in the banner — the operator is looking there, not at the
   * corner of the screen. A network failure additionally raises a toast, because
   * it means the bench laptop has lost the API and every following scan will
   * fail too; a plain GraphQL rejection is per-device and stays inline.
   */
  private reportFailure(context: string, err: unknown): void {
    const detail = errorText(err);
    this.banner.set({ kind: 'error', kicker: 'Failed', text: `${context} — ${detail}` });
    if (isNetworkError(err)) {
      this.toastr.error(detail, 'Connection problem');
    }
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  bannerClass(kind: BannerKind): string {
    return `scanner-banner scanner-banner--${kind}`;
  }

  bannerIcon(kind: BannerKind): string {
    switch (kind) {
      case 'success':
        return 'fas fa-check-circle';
      case 'warning':
        return 'fas fa-exclamation-triangle';
      case 'error':
        return 'fas fa-times-circle';
      case 'info':
        return 'fas fa-crosshairs';
      default:
        return 'fas fa-barcode';
    }
  }

  countFor(mode: ScannerMode): number {
    return this.tally()[mode.key] ?? 0;
  }
}

const IDLE_BANNER: Banner = {
  kind: 'neutral',
  kicker: 'Idle',
  text: 'Not armed. Scan a mode card or choose a mode to start.',
};

/** True when the element accepts typing and must not have focus stolen from it. */
function isTypingTarget(el: HTMLElement): boolean {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function describeKit(kit: ScannerKit): string {
  return [kit.make, kit.model].filter(Boolean).join(' ') || 'Unknown device';
}

function isBlockedByFlag(mode: ScannerMode, kit: ScannerKit): boolean {
  if (!FLAG_BLOCKED_STATUSES.includes(mode.key)) {
    return false;
  }
  const flags = kit.subStatus;
  return !!flags && BLOCKING_FLAGS.some(flag => !!flags[flag]);
}

function formatTime(at: Date): string {
  return at.toTimeString().slice(0, 5);
}

function isNetworkError(err: unknown): boolean {
  return !!(err && typeof err === 'object' && (err as { networkError?: unknown }).networkError);
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      graphQLErrors?: { message: string }[];
      networkError?: { message?: string };
      message?: string;
    };
    if (e.graphQLErrors?.length) {
      return e.graphQLErrors[0].message;
    }
    if (e.networkError?.message) {
      return e.networkError.message;
    }
    if (e.message) {
      return e.message;
    }
  }
  return String(err);
}
