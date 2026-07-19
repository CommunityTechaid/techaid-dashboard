import {
  AfterViewInit,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { parseScan, ScanEvent } from './scan-parser';
import { ScanSession } from './scan-session';

/**
 * Keyboard-wedge scan input. Barcode scanners "type" the barcode then press Enter;
 * this component owns a text input it keeps focused ("armed") and, on Enter, parses
 * the buffered value and surfaces it — both as a `(scan)` output and (if a
 * {@link ScanSession} is supplied) by dispatching through the session's strategy.
 *
 * Reusable by both prep-mode and the later OS-install mode: it knows nothing about
 * what a scan *means* — that lives in the mode strategy.
 *
 * Focus etiquette: it only auto-refocuses while `armed` is true, so it does not
 * fight the operator typing into another field on the same page. When focus is
 * lost it shows a "click to re-arm" affordance instead of grabbing focus back.
 */
@Component({
  selector: 'app-scan-input',
  standalone: true,
  imports: [],
  template: `
    <div class="scan-input" [class.scan-input--armed]="armed() && focused()">
      <div class="scan-input__status">
        @if (armed() && focused()) {
          <span class="badge bg-success">● Armed — ready to scan</span>
        } @else if (armed()) {
          <span class="badge bg-warning text-dark">Focus lost</span>
          <button type="button" class="btn btn-sm btn-outline-primary ms-2" (click)="rearm()">
            Click to re-arm
          </button>
        } @else {
          <span class="badge bg-secondary">Disarmed</span>
        }
      </div>

      <input
        #field
        type="text"
        class="form-control scan-input__field"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        (keydown.enter)="onEnter(field)"
        (focus)="focused.set(true)"
        (blur)="onBlur()"
      />

      @if (displayHistory().length) {
        <ul class="scan-input__history list-unstyled mt-2 mb-0">
          @for (event of displayHistory(); track $index) {
            <li class="scan-input__row" [class]="rowClass(event)">
              <span class="scan-input__outcome">{{ describe(event) }}</span>
              <code class="scan-input__raw">{{ event.raw }}</code>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .scan-input {
        display: block;
        width: 100%;
      }
      .scan-input__status {
        margin-bottom: 0.5rem;
        display: flex;
        align-items: center;
      }
      .scan-input__field {
        font-size: 1.1rem;
        letter-spacing: 0.03em;
      }
      .scan-input--armed .scan-input__field {
        border-color: var(--bs-success, #198754);
        box-shadow: 0 0 0 0.2rem rgba(25, 135, 84, 0.2);
      }
      .scan-input__history {
        font-size: 0.85rem;
      }
      .scan-input__row {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
      }
      .scan-input__row--kit {
        background: rgba(25, 135, 84, 0.1);
      }
      .scan-input__row--action {
        background: rgba(13, 110, 253, 0.1);
      }
      .scan-input__row--unknown {
        background: rgba(220, 53, 69, 0.12);
      }
      .scan-input__raw {
        color: #6c757d;
      }
    `,
  ],
})
export class ScanInputComponent implements AfterViewInit {
  /** When true the component keeps its input focused. Host controls this. */
  readonly armed = input(true);

  /** Optional session; when set, each scan is dispatched through its strategy. */
  readonly session = input<ScanSession | null>(null);

  readonly label = input('Barcode scan');
  readonly placeholder = input('Scan a barcode…');

  /** Emitted for every non-empty scan, whether or not a session is attached. */
  readonly scan = output<ScanEvent>();

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Whether the input currently holds focus (drives the armed/lost UI). */
  readonly focused = signal(false);

  /** Locally-tracked history, used only when no session is attached. */
  private readonly localHistory = signal<ScanEvent[]>([]);

  /** Prefer the session's history (single source of truth) when one is attached. */
  readonly displayHistory = computed<ScanEvent[]>(() => {
    const session = this.session();
    return session ? session.history() : this.localHistory();
  });

  constructor() {
    // Re-focus when the host (re-)arms the component.
    effect(() => {
      if (this.armed()) {
        queueMicrotask(() => this.focusField());
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.armed()) {
      this.focusField();
    }
  }

  onEnter(field: HTMLInputElement): void {
    const raw = field.value;
    field.value = '';
    if (!raw.trim()) {
      return;
    }

    const session = this.session();
    const event = session ? session.submit(raw) : parseScan(raw);
    if (!event) {
      return;
    }
    if (!session) {
      this.localHistory.update((prev) => [event, ...prev].slice(0, 8));
    }
    this.scan.emit(event);
  }

  onBlur(): void {
    this.focused.set(false);
    if (this.armed()) {
      // Small delay so a deliberate click elsewhere on the page wins; if nothing
      // else took focus we re-arm the scanner input.
      setTimeout(() => {
        if (this.armed() && !this.focused()) {
          this.focusField();
        }
      }, 150);
    }
  }

  rearm(): void {
    this.focusField();
  }

  private focusField(): void {
    this.field()?.nativeElement.focus();
  }

  describe(event: ScanEvent): string {
    switch (event.kind) {
      case 'kit-id':
        return `Kit #${event.id}`;
      case 'action':
        return `Action: ${event.code}`;
      case 'unknown':
        return 'Unrecognised scan';
    }
  }

  rowClass(event: ScanEvent): string {
    return `scan-input__row scan-input__row--${event.kind === 'kit-id' ? 'kit' : event.kind}`;
  }
}
