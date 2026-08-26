import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Borough, CORE_BOROUGHS } from '@app/shared/utils/boroughs';
import { PostcodeLookup, WardLookupService } from '@app/shared/services/ward-lookup.service';

export const DISTRIBUTIONS_EMAIL = 'distributions@communitytechaid.org.uk';

/** What the user is currently looking at. Mirrors the states drawn in design option 1b. */
type StepState =
  | 'empty' // 1b state 1 — nothing entered yet
  | 'checking' // 1b state 2 — button busy, input stays editable
  | 'covered' // 1b state 3 — resolved to a supported borough
  | 'out-of-area' // 1b state 4 — well-formed, but we do not cover it
  | 'malformed' // 1b state 5a — does not look like a postcode
  | 'unavailable'; // 1b state 5b — the lookup itself failed

/**
 * The postcode-first location step on the public device request page.
 *
 * One postcode field, one derived borough and ward, one confirmation. There is deliberately no
 * ward picker and no map: the user tells us where their client lives, we tell them whether we
 * cover it. See issue #178.
 *
 * This is the streamlined half of a two-way substitution — the legacy `communitytechaid.github.io`
 * iframe is still live behind the same flag, and both halves must leave the page in an identical
 * state. That is why this component's whole output surface is two events carrying plain strings:
 * `confirmed` mirrors what the iframe's postMessage delivers, `notSupported` mirrors its
 * "unsupported" sentinel. Resist enriching them — a richer location object that only this path
 * produces is exactly what would make the two paths diverge.
 */
@Component({
  selector: 'postcode-location-step',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .postcode-step {
        max-width: 34rem;
        margin: 0 auto;
      }
      .postcode-step input {
        text-transform: uppercase;
      }
      /* The lookup runs against a local table, so a fast result can flash the busy state on and
         off in a single frame. Fading in makes that read as a response rather than a glitch. */
      .postcode-result {
        animation: postcode-result-in 120ms ease-out;
      }
      /* Licence acknowledgements, not page copy. Bootstrap's .small (0.875em) still read as a
         paragraph competing with the postcode result, so the size is set explicitly here rather
         than by stacking another utility class. Kept at 11px and on the muted-not-faint colour:
         the OGL requires the acknowledgement to be shown, not merely present. */
      .postcode-attribution {
        font-size: 0.6875rem;
        line-height: 1.35;
      }
      @keyframes postcode-result-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `,
  ],
  template: `
    <div class="postcode-step py-4">
      <h3 class="h5 font-weight-bold text-primary text-center">Where does your client live?</h3>
      <p class="text-muted text-center">
        Enter their postcode — we'll work out the borough and ward.
      </p>

      <form class="d-flex gap-2 justify-content-center my-3" (ngSubmit)="check()">
        <label class="visually-hidden" for="postcode">Postcode</label>
        <input
          id="postcode"
          name="postcode"
          class="form-control"
          style="max-width: 14rem;"
          autocomplete="postal-code"
          autocapitalize="characters"
          spellcheck="false"
          [(ngModel)]="postcode"
          (ngModelChange)="onPostcodeChanged()"
          [attr.aria-invalid]="state === 'malformed' ? 'true' : null"
          aria-describedby="postcode-result"
        />
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="state === 'checking' || !postcode.trim()"
          [attr.aria-busy]="state === 'checking' ? 'true' : null"
        >
          @if (state === 'checking') {
            <i class="fas fa-spinner fa-spin"></i> Checking…
          } @else {
            Check
          }
        </button>
      </form>

      <div id="postcode-result" aria-live="polite">
        @if (covered; as resolved) {
          <div class="alert alert-success postcode-result" data-testid="postcode-covered">
            <div class="font-weight-bold">
              <i class="fas fa-check-circle"></i> We support this area
            </div>
            <p class="mb-3 mt-2">
              <b>{{ resolved.ward }}</b> ward, <b>{{ resolved.borough.name }}</b>
            </p>
            <button type="button" class="btn btn-primary" (click)="confirm()">
              Submit a request
            </button>
          </div>
        }

        @if (state === 'out-of-area') {
          <div class="alert alert-danger postcode-result" data-testid="postcode-out-of-area">
            <div class="font-weight-bold">{{ result?.postcode }}</div>
            <p class="mb-0 mt-2">
              Unfortunately we don't support this area at the moment. Please
              <a [href]="'mailto:' + distributionsEmail">email us</a> for further information.
            </p>
          </div>
        }

        @if (state === 'malformed') {
          <div class="alert alert-warning postcode-result" data-testid="postcode-malformed">
            <p class="mb-0">
              That doesn't look like a postcode. Please check it and try again, or
              <a [href]="'mailto:' + distributionsEmail">email</a> us to discuss further
            </p>
          </div>
        }

        @if (state === 'unavailable') {
          <div class="alert alert-warning postcode-result" data-testid="postcode-unavailable">
            <p class="mb-0">
              We couldn't check that postcode just now. Please try again in a moment, or
              <a [href]="'mailto:' + distributionsEmail">email</a> us to discuss further
            </p>
          </div>
        }
      </div>

      @if (attribution.length) {
        <p class="text-muted postcode-attribution mt-4 mb-0" data-testid="postcode-attribution">
          @for (line of attribution; track line) {
            {{ line }}<br />
          }
        </p>
      }
    </div>
  `,
})
export class PostcodeLocationStepComponent implements OnInit {
  /**
   * The boroughs currently accepted, from FeatureFlagService.supportedBoroughs().
   *
   * The lookup table always contains all three boroughs, so this is what decides whether a
   * resolved postcode is *accepted* — a Tower Hamlets postcode with the borough flag off
   * resolves fine and is then treated as out of area. Keeping "where is it" and "do we take it"
   * as separate questions is what lets #179 change the second one without touching the table.
   */
  @Input() supportedBoroughs: readonly Borough[] = CORE_BOROUGHS;

  /**
   * Emitted on "Submit a request". Payload matches what the legacy iframe posts, so the parent's
   * handler for the two paths is the same code.
   *
   * There is deliberately no matching "out of area" output. The legacy path answers that case by
   * setting `wardSubmitted` and swapping the whole page for a terminal Formly out-of-area screen;
   * this path keeps the user on the step and shows the card inline, per design 1b, so a mistyped
   * postcode can simply be retyped instead of dead-ending the visitor. Both block progress, which
   * is what the convergence requirement is actually about — nothing downstream of a *successful*
   * location can tell which path ran.
   */
  @Output() confirmed = new EventEmitter<{ borough: string; ward: string }>();

  postcode = '';
  state: StepState = 'empty';
  result: PostcodeLookup | null = null;

  /** The postcode the in-flight lookup was started for, so a superseded result can be dropped. */
  private checking: string | null = null;

  /**
   * Open Government Licence attribution for the ONS/Royal Mail/OS data behind the lookup.
   *
   * The licence requires these acknowledgements wherever the derived data is published, and this
   * public page is where we publish it — so they are rendered, not merely carried in the
   * artefact. Read from the artefact's own `meta` block so they cannot drift from the data.
   */
  attribution: string[] = [];

  readonly distributionsEmail = DISTRIBUTIONS_EMAIL;

  constructor(
    private readonly wardLookup: WardLookupService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  /** The resolved result, but only while it is actually being shown as covered. */
  get covered(): Extract<PostcodeLookup, { status: 'resolved' }> | null {
    return this.state === 'covered' && this.result?.status === 'resolved' ? this.result : null;
  }

  /** Clear a stale result as soon as the postcode changes, so it cannot be read as current. */
  onPostcodeChanged(): void {
    if (this.state !== 'empty' && this.state !== 'checking') {
      this.state = 'empty';
      this.result = null;
    }
  }

  /**
   * Only fetched once the step is on screen — the table is not touched, and its ~22 KB not
   * downloaded, unless a visitor actually reaches the location step.
   */
  ngOnInit(): void {
    this.wardLookup.meta().subscribe((meta) => {
      this.attribution = meta?.attribution ?? [];
      this.changeDetectorRef.markForCheck();
    });
  }

  check(): void {
    const entered = this.postcode.trim();
    if (!entered || this.state === 'checking') return;

    this.state = 'checking';
    this.result = null;
    this.checking = entered;

    this.wardLookup.lookup(entered).subscribe((result) => {
      // Drop a result the user has already moved on from. The input stays editable while the
      // lookup runs (design 1b), and the first lookup waits on a 63 KB fetch — long enough to
      // type a different postcode. Without this guard, editing SE1 1AA to E1 6AN mid-flight
      // would render "Southwark" against an input reading E1 6AN, and "That's right" would
      // confirm the borough the user was no longer asking about.
      if (this.checking !== entered) return;
      this.checking = null;

      this.result = result;
      this.state = this.stateFor(result);
      // The lookup resolves outside Angular's view check on a cached table, and this component
      // is OnPush — without this the result can sit unrendered until the next event.
      this.changeDetectorRef.markForCheck();
    });
  }

  /**
   * A resolved postcode is only "covered" if its borough is currently accepted.
   *
   * Note that a not-found postcode and an out-of-area one land in the same place on purpose.
   * The table holds only the boroughs we serve, so a miss tells us nothing about where the
   * postcode actually is — it could be Lewisham, or it could be a new-build in Southwark that
   * postdates our ONSPD edition. We do not guess, and we never name a borough we cannot stand
   * behind. The email escape hatch is what covers the difference.
   */
  private stateFor(result: PostcodeLookup): StepState {
    switch (result.status) {
      case 'malformed':
        return 'malformed';
      case 'unavailable':
        return 'unavailable';
      case 'not-found':
        return 'out-of-area';
      case 'resolved':
        return this.supportedBoroughs.some((b) => b.code === result.borough.code)
          ? 'covered'
          : 'out-of-area';
    }
  }

  confirm(): void {
    // Gated on `covered`, not merely on the result being resolved: a resolved postcode in an
    // unsupported borough must not be confirmable even if this is called outside the template.
    const resolved = this.covered;
    if (!resolved) return;
    this.confirmed.emit({ borough: resolved.borough.name, ward: resolved.ward });
  }
}
