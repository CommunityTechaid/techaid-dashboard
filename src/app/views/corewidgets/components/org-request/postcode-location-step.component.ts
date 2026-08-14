import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Borough, boroughListSentence, CORE_BOROUGHS } from '@app/shared/utils/boroughs';
import { PostcodeLookup, WardLookupService } from '@app/shared/services/ward-lookup.service';

/**
 * Where the "See other services near you" link points.
 *
 * TODO(#178): the design draws this as a link but does not say what it links to, and no such
 * destination exists anywhere else in the codebase. Pointed at the main site as a safe default
 * — swap it for the real signposting page when someone confirms what that is. Flagged in the PR.
 */
export const OTHER_SERVICES_URL = 'https://communitytechaid.org.uk';

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
              That's right
            </button>
          </div>
        }

        @if (state === 'out-of-area') {
          <div class="alert alert-danger postcode-result" data-testid="postcode-out-of-area">
            <div class="font-weight-bold">{{ result?.postcode }}</div>
            <p class="mb-0 mt-2">
              We only take referrals from {{ supportedSentence }}.
              <a [href]="otherServicesUrl" target="_blank" rel="noopener">
                See other services near you</a
              >
              or <a [href]="'mailto:' + distributionsEmail">email</a> us to discuss further
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
    </div>
  `,
})
export class PostcodeLocationStepComponent {
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
   * Emitted on "That's right". Payload matches what the legacy iframe posts, so the parent's
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

  readonly otherServicesUrl = OTHER_SERVICES_URL;
  readonly distributionsEmail = DISTRIBUTIONS_EMAIL;

  constructor(
    private readonly wardLookup: WardLookupService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  get supportedSentence(): string {
    return boroughListSentence(this.supportedBoroughs, 'and');
  }

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

  check(): void {
    const entered = this.postcode.trim();
    if (!entered || this.state === 'checking') return;

    this.state = 'checking';
    this.result = null;

    this.wardLookup.lookup(entered).subscribe((result) => {
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
    if (this.result?.status !== 'resolved') return;
    this.confirmed.emit({ borough: this.result.borough.name, ward: this.result.ward });
  }
}
