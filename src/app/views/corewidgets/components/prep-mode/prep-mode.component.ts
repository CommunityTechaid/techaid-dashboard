import { Component, OnInit, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ScanInputComponent } from '../scan/scan-input.component';
import { ScanModeStrategy, ScanSession } from '../scan/scan-session';
import { PrepApiService, QueueRange } from './prep-api.service';
import {
  ITEM_KEY_LABELS,
  KIT_TYPE_TO_ITEM_KEY,
  PrepKit,
  PrepQueueItem,
  PrepRequest,
  TypeProgressRow,
} from './models';

type Phase = 'picker' | 'prepping' | 'done';
type QueueMode = 'day' | 'week';

interface Banner {
  kind: 'success' | 'warning' | 'error' | 'info';
  text: string;
}

/**
 * Device prep mode — a scan-driven sequential workflow for warehouse staff
 * (stage 2 of the prototype for CommunityTechaid/techaid-server#69).
 *
 * Pick a day or week → walk the queue of requests scheduled for it → scan kit
 * barcodes to assign them (type validated display-only against requested counts)
 * → scan CTA*COMPLETE to flag the request prepped and auto-advance, or CTA*SKIP to
 * move on without writing. Implements {@link ScanModeStrategy}; the mode-agnostic
 * {@link ScanSession} + {@link ScanInputComponent} own the keyboard-wedge plumbing.
 *
 * Default change detection (like the booking flow) — NOT OnPush.
 */
@Component({
  selector: 'app-prep-mode',
  standalone: true,
  imports: [FormsModule, DatePipe, ScanInputComponent],
  providers: [ScanSession, PrepApiService],
  template: `
    <div class="container-fluid py-3 prep-mode">
      <h1 class="h4 mb-3">
        <i class="fas fa-barcode me-2"></i>Device Prep Mode
        <span class="badge bg-secondary align-middle ms-2">prototype</span>
      </h1>

      <!-- ── Phase: queue picker ─────────────────────────────────────────── -->
      @if (phase() === 'picker') {
        <div class="card">
          <div class="card-body">
            <h2 class="h6 text-muted mb-3">Choose what to prep</h2>

            <div class="btn-group mb-3" role="group" aria-label="Queue mode">
              <input
                type="radio"
                class="btn-check"
                name="queueMode"
                id="mode-day"
                value="day"
                [(ngModel)]="queueMode"
              />
              <label class="btn btn-outline-primary" for="mode-day">A single day</label>
              <input
                type="radio"
                class="btn-check"
                name="queueMode"
                id="mode-week"
                value="week"
                [(ngModel)]="queueMode"
              />
              <label class="btn btn-outline-primary" for="mode-week">A whole week</label>
            </div>

            <div class="mb-3" style="max-width: 20rem;">
              <label class="form-label" for="prep-date">
                {{ queueMode === 'week' ? 'Any date in the week' : 'Collection / delivery date' }}
              </label>
              <input
                type="date"
                class="form-control"
                id="prep-date"
                [(ngModel)]="pickedDate"
              />
            </div>

            <div class="form-check mb-3">
              <input
                type="checkbox"
                class="form-check-input"
                id="include-prepped"
                [(ngModel)]="includePrepped"
              />
              <label class="form-check-label" for="include-prepped">
                Include already-prepped requests (shown as done)
              </label>
            </div>

            @if (queueError()) {
              <div class="alert alert-danger py-2">{{ queueError() }}</div>
            }

            <button
              type="button"
              class="btn btn-primary"
              [disabled]="!pickedDate || loadingQueue()"
              (click)="startQueue()"
            >
              @if (loadingQueue()) {
                <span class="spinner-border spinner-border-sm me-1"></span>
              }
              Start prepping
            </button>
          </div>
        </div>
      }

      <!-- ── Phase: prepping a request ───────────────────────────────────── -->
      @if (phase() === 'prepping') {
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="text-muted">{{ progressLabel() }}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="resetQueue()">
            <i class="fas fa-times me-1"></i>Exit queue
          </button>
        </div>

        @if (loadingRequest()) {
          <div class="card"><div class="card-body text-center py-5">
            <span class="spinner-border"></span>
            <p class="mt-2 mb-0 text-muted">Loading request…</p>
          </div></div>
        } @else if (currentRequest(); as req) {
          <div class="row g-3">
            <!-- Left: request context -->
            <div class="col-lg-5">
              <div class="card h-100">
                <div class="card-body">
                  <div class="d-flex justify-content-between align-items-start">
                    <h2 class="h5 mb-1">Request #{{ req.id }}</h2>
                    @if (req.isPrepped) {
                      <span class="badge bg-success">Already prepped</span>
                    }
                  </div>
                  <p class="mb-1">
                    <strong>{{ req.referringOrganisationContact?.referringOrganisation?.name || 'Unknown org' }}</strong>
                  </p>
                  <p class="text-muted mb-1">
                    Referee: {{ req.referringOrganisationContact?.fullName || '—' }}
                  </p>
                  @if (req.clientRef) {
                    <p class="text-muted mb-1">Client ref: {{ req.clientRef }}</p>
                  }
                  @if (req.collectionDate) {
                    <p class="text-muted mb-1">
                      {{ methodLabel(req.collectionMethod) }}:
                      {{ req.collectionDate | date: 'EEE d MMM y, HH:mm' }}
                    </p>
                  }

                  <hr />
                  <h3 class="h6 text-uppercase text-muted">Notes</h3>
                  @if (req.details) {
                    <div class="alert alert-info py-2 mb-2 prep-mode__notes">{{ req.details }}</div>
                  }
                  @for (note of req.deviceRequestNotes || []; track note.id) {
                    <div class="border-start border-3 ps-2 mb-2 small">
                      <div>{{ note.content }}</div>
                      <div class="text-muted">— {{ note.volunteer || 'volunteer' }}</div>
                    </div>
                  }
                  @if (!req.details && !(req.deviceRequestNotes || []).length) {
                    <p class="text-muted fst-italic">No notes on this request.</p>
                  }
                </div>
              </div>
            </div>

            <!-- Right: counts, assigned kits, scanning -->
            <div class="col-lg-7">
              <div class="card mb-3">
                <div class="card-body">
                  <h3 class="h6 text-uppercase text-muted">Requested vs assigned</h3>
                  <div class="table-responsive">
                    <table class="table table-sm mb-0 align-middle">
                      <tbody>
                        @for (row of typeProgress(); track row.key) {
                          <tr [class.table-warning]="row.assigned > row.requested">
                            <td>{{ row.label }}</td>
                            <td class="text-end fw-bold" style="width: 6rem;">
                              {{ row.assigned }}/{{ row.requested }}
                              @if (row.assigned > row.requested) {
                                <i class="fas fa-exclamation-triangle text-warning ms-1"
                                   title="More assigned than requested"></i>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div class="card mb-3">
                <div class="card-body">
                  <h3 class="h6 text-uppercase text-muted">
                    Assigned kits ({{ (req.kits || []).length }})
                  </h3>
                  @if ((req.kits || []).length) {
                    <ul class="list-group list-group-flush">
                      @for (kit of req.kits || []; track kit.id) {
                        <li class="list-group-item d-flex justify-content-between px-0 py-1">
                          <span><code>#{{ kit.id }}</code> {{ kit.type }}</span>
                          <span class="text-muted small">{{ kitDescription(kit) }}</span>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="text-muted fst-italic mb-0">No kits assigned yet. Scan one.</p>
                  }
                </div>
              </div>

              <!-- Banner: non-blocking scan feedback -->
              @if (banner(); as b) {
                <div class="alert py-2" [class]="bannerClass(b)">{{ b.text }}</div>
              }
              @if (busy()) {
                <div class="alert alert-secondary py-2">
                  <span class="spinner-border spinner-border-sm me-1"></span>
                  Processing — rescan in a moment.
                </div>
              }

              <div class="card">
                <div class="card-body">
                  <app-scan-input
                    [session]="session"
                    [armed]="armed()"
                    label="Scan a kit barcode or action code"
                    placeholder="Scan kit / CTA*COMPLETE / CTA*SKIP…"
                  />
                  <div class="d-flex gap-2 mt-3">
                    <button
                      type="button"
                      class="btn btn-success"
                      [disabled]="busy()"
                      (click)="handleAction('COMPLETE', 'manual')"
                    >
                      <i class="fas fa-check me-1"></i>Complete (CTA*COMPLETE)
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-secondary"
                      [disabled]="busy()"
                      (click)="handleAction('SKIP', 'manual')"
                    >
                      <i class="fas fa-forward me-1"></i>Skip (CTA*SKIP)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }
      }

      <!-- ── Phase: queue done ───────────────────────────────────────────── -->
      @if (phase() === 'done') {
        <div class="card">
          <div class="card-body text-center py-5">
            <i class="fas fa-check-circle text-success fa-3x mb-3"></i>
            <h2 class="h5">Queue complete</h2>
            <p class="text-muted">
              You worked through {{ queue().length }} request(s).
            </p>
            <button type="button" class="btn btn-primary" (click)="resetQueue()">
              Prep another day / week
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .prep-mode__notes {
        white-space: pre-wrap;
      }
    `,
  ],
})
export class PrepModeComponent implements OnInit, ScanModeStrategy {
  // ── Picker state ──────────────────────────────────────────────────────────
  queueMode: QueueMode = 'day';
  pickedDate = '';
  includePrepped = false;

  // ── Flow state ────────────────────────────────────────────────────────────
  readonly phase = signal<Phase>('picker');
  readonly queue = signal<PrepQueueItem[]>([]);
  readonly queueIndex = signal(0);
  readonly currentRequest = signal<PrepRequest | null>(null);

  readonly loadingQueue = signal(false);
  readonly loadingRequest = signal(false);
  readonly queueError = signal<string | null>(null);

  /** In-flight guard: while true, scans are ignored (surfaced as "processing"). */
  readonly busy = signal(false);

  /** Non-blocking scan feedback shown to the operator. */
  readonly banner = signal<Banner | null>(null);

  readonly armed = computed(() => this.phase() === 'prepping' && !this.loadingRequest());

  readonly progressLabel = computed(() => {
    const total = this.queue().length;
    return total ? `Request ${this.queueIndex() + 1} of ${total}` : '';
  });

  /** Requested vs currently-assigned counts, per device type. */
  readonly typeProgress = computed<TypeProgressRow[]>(() => {
    const req = this.currentRequest();
    const items = req?.deviceRequestItems;
    const assigned = this.assignedCountsByKey(req);
    return ITEM_KEY_LABELS.map(({ key, label }) => ({
      key,
      label,
      requested: (items?.[key] as number) ?? 0,
      assigned: assigned[key] ?? 0,
    }));
  });

  constructor(
    readonly session: ScanSession,
    private readonly api: PrepApiService,
    private readonly titleService: Title,
  ) {
    this.titleService.setTitle('TaDa - Device Prep Mode');
  }

  ngOnInit(): void {
    this.session.setStrategy(this);
    // Default the picker to today for convenience.
    this.pickedDate = new Date().toISOString().slice(0, 10);
  }

  // ── Queue lifecycle ────────────────────────────────────────────────────────

  async startQueue(): Promise<void> {
    if (!this.pickedDate) {
      return;
    }
    this.loadingQueue.set(true);
    this.queueError.set(null);
    try {
      const range = this.computeRange(this.queueMode, this.pickedDate);
      const items = await this.api.loadQueue(range);
      this.queue.set(items);
      this.queueIndex.set(0);
      this.session.reset();
      if (!items.length) {
        this.queueError.set('No requests found for that day/week with the chosen filter.');
        return;
      }
      this.phase.set('prepping');
      await this.openIndex(0);
    } catch (err) {
      this.queueError.set(this.errorText(err));
    } finally {
      this.loadingQueue.set(false);
    }
  }

  private async openIndex(index: number): Promise<void> {
    const item = this.queue()[index];
    if (!item) {
      this.phase.set('done');
      return;
    }
    this.loadingRequest.set(true);
    this.banner.set(null);
    try {
      const req = await this.api.loadRequest(item.id);
      this.currentRequest.set(req);
      if (!req) {
        this.banner.set({ kind: 'error', text: `Request #${item.id} could not be loaded.` });
      }
    } catch (err) {
      this.banner.set({ kind: 'error', text: this.errorText(err) });
    } finally {
      this.loadingRequest.set(false);
    }
  }

  /** Move to the next request, or the done state at the end of the queue. */
  private async advance(): Promise<void> {
    const next = this.queueIndex() + 1;
    this.session.reset();
    if (next >= this.queue().length) {
      this.currentRequest.set(null);
      this.phase.set('done');
      return;
    }
    this.queueIndex.set(next);
    await this.openIndex(next);
  }

  resetQueue(): void {
    this.phase.set('picker');
    this.queue.set([]);
    this.queueIndex.set(0);
    this.currentRequest.set(null);
    this.banner.set(null);
    this.session.reset();
  }

  // ── ScanModeStrategy ────────────────────────────────────────────────────────

  handleKitId(id: number): void {
    // Synchronous in-flight guard: set busy BEFORE any await so overlapping scans
    // (a scanner can fire again before we resolve) are cleanly ignored.
    if (this.busy()) {
      this.banner.set({ kind: 'warning', text: 'Still processing the last scan — rescan in a moment.' });
      return;
    }
    const req = this.currentRequest();
    if (!req) {
      this.banner.set({ kind: 'error', text: 'No request open to assign a kit to.' });
      return;
    }
    this.busy.set(true);
    void this.assignScannedKit(req, id).finally(() => this.busy.set(false));
  }

  private async assignScannedKit(req: PrepRequest, id: number): Promise<void> {
    try {
      const kit = await this.api.loadKit(id);
      if (!kit) {
        this.banner.set({ kind: 'error', text: `Kit #${id} not found — nothing assigned.` });
        return;
      }

      // Display-only validation: does this kit's type still have requested headroom?
      const itemKey = KIT_TYPE_TO_ITEM_KEY[kit.type];
      const progress = this.typeProgress().find((r) => r.key === itemKey);
      const overRequested = !itemKey || !progress || progress.assigned >= progress.requested;

      // PRODUCT DECISION: a kit whose type has no remaining requested count is still
      // assigned (substitution / over-supply rules are undecided) — we only WARN.
      const assignedIds = await this.api.assignKit(req.id, id);
      const landed = assignedIds.some((k) => String(k) === String(id));
      if (!landed) {
        this.banner.set({ kind: 'error', text: `Kit #${id} was not assigned (server rejected it).` });
        return;
      }

      // Refetch the request so assigned kits/counts refresh — never hand-patch the
      // frozen Apollo result in place (architecture contract §2).
      const refreshed = await this.api.loadRequest(req.id);
      if (refreshed) {
        this.currentRequest.set(refreshed);
      }

      if (overRequested) {
        this.banner.set({
          kind: 'warning',
          text: `Kit #${id} (${kit.type}) assigned — but no ${progress?.label ?? 'matching'} were requested. Check this is intended.`,
        });
      } else {
        this.banner.set({ kind: 'success', text: `Kit #${id} (${kit.type}) assigned.` });
      }
    } catch (err) {
      this.banner.set({ kind: 'error', text: this.errorText(err) });
    }
  }

  handleAction(code: string, _raw: string): void {
    if (this.busy()) {
      this.banner.set({ kind: 'warning', text: 'Still processing — rescan the action in a moment.' });
      return;
    }
    switch (code) {
      case 'COMPLETE':
        this.busy.set(true);
        void this.completeCurrent().finally(() => this.busy.set(false));
        break;
      case 'SKIP':
        // PRODUCT DECISION: SKIP just advances without writing anything — whether a
        // skip should be recorded/audited anywhere is undecided.
        this.banner.set({ kind: 'info', text: 'Skipped — no changes written.' });
        void this.advance();
        break;
      default:
        this.banner.set({ kind: 'error', text: `Unknown action code "${code}".` });
    }
  }

  private async completeCurrent(): Promise<void> {
    const req = this.currentRequest();
    if (!req) {
      this.banner.set({ kind: 'error', text: 'No request open to complete.' });
      return;
    }
    // PRODUCT DECISION: COMPLETE is allowed even when requested counts are unmet
    // (partial preps are undecided) — we warn inline but still flag it prepped.
    const unmet = this.typeProgress().some((r) => r.assigned < r.requested);
    try {
      await this.api.markPrepped(req.id);
      this.banner.set({
        kind: unmet ? 'warning' : 'success',
        text: unmet
          ? `Request #${req.id} marked prepped with some requested counts unmet.`
          : `Request #${req.id} marked prepped.`,
      });
      await this.advance();
    } catch (err) {
      this.banner.set({ kind: 'error', text: this.errorText(err) });
    }
  }

  handleUnknown(raw: string): void {
    this.banner.set({ kind: 'error', text: `Unrecognised scan: "${raw}".` });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  methodLabel(method?: string | null): string {
    if (method === 'DELIVERY') return 'Delivery';
    if (method === 'COLLECTION') return 'Collection';
    return 'Collection';
  }

  kitDescription(kit: PrepKit): string {
    return [kit.make, kit.model].filter(Boolean).join(' / ');
  }

  bannerClass(b: Banner): string {
    switch (b.kind) {
      case 'success':
        return 'alert-success';
      case 'warning':
        return 'alert-warning';
      case 'error':
        return 'alert-danger';
      default:
        return 'alert-info';
    }
  }

  /** Tally assigned kits by the request-item key their type maps onto. */
  private assignedCountsByKey(req: PrepRequest | null): Partial<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const kit of req?.kits ?? []) {
      const key = KIT_TYPE_TO_ITEM_KEY[kit.type];
      if (key) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }

  /** Compute an inclusive [start,end] ISO range for a day or its containing week. */
  private computeRange(mode: QueueMode, dateStr: string): QueueRange {
    // Parse as local midnight so ranges align with the operator's day.
    const base = new Date(`${dateStr}T00:00:00`);
    let start: Date;
    let end: Date;
    if (mode === 'week') {
      // Monday 00:00 → Sunday 23:59:59.999 of the week containing `base`.
      const dow = (base.getDay() + 6) % 7; // 0 = Monday
      start = new Date(base);
      start.setDate(base.getDate() - dow);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(base);
      start.setHours(0, 0, 0, 0);
      end = new Date(base);
      end.setHours(23, 59, 59, 999);
    }
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      unpreppedOnly: !this.includePrepped,
    };
  }

  private errorText(err: unknown): string {
    if (err && typeof err === 'object') {
      const anyErr = err as { graphQLErrors?: { message: string }[]; networkError?: { message?: string }; message?: string };
      if (anyErr.graphQLErrors?.length) {
        return anyErr.graphQLErrors[0].message;
      }
      if (anyErr.networkError?.message) {
        return anyErr.networkError.message;
      }
      if (anyErr.message) {
        return anyErr.message;
      }
    }
    return String(err);
  }
}
