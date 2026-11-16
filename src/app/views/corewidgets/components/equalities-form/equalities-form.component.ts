import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { firstValueFrom } from 'rxjs';
import { graphQLErrorCodes, graphQLErrorMessages } from '@app/shared/utils/apollo-error';
import { describeError } from '@app/shared/utils/error-toast';
import { refForError } from '@app/shared/utils/error-ref';
import { EQUALITIES_INTRO, EQUALITIES_QUESTIONS, EqualitiesQuestion } from './equalities-questions';

export const SUBMIT_EQUALITIES = gql`
  mutation submitEqualities($data: SubmitEqualitiesInput!) {
    submitEqualities(data: $data)
  }
`;

/** Server refusal codes (techaid-server EqualitiesMutations). */
const REQUEST_NOT_FOUND = 'EQUALITIES_REQUEST_NOT_FOUND';
const INVALID_ANSWERS = 'EQUALITIES_INVALID_ANSWERS';
const SHEET_UNAVAILABLE = 'EQUALITIES_SHEET_UNAVAILABLE';

/** How long to wait before the one automatic retry after a network failure (the API cold-starts). */
const NETWORK_RETRY_DELAY_MS = 3000;

type FormState = 'answering' | 'submitting' | 'done' | 'error';

interface FormError {
  text: string;
  ref?: string;
  /** 'retry' keeps the answers and offers Try again; 'restart' clears them; 'none' is final. */
  action: 'retry' | 'restart' | 'none';
}

/**
 * The recipient equalities form, shown on the public request form after the device request is
 * created, in place of the equalities Typeform (f93D0s88) while the `native-equalities-form` flag
 * is on. Built from the #265 prototype.
 *
 * The answers are special category data. They are sent once, to submitEqualities, which appends
 * them to the isolated equalities Google Sheet; TaDa stores none of them. On this side they live
 * only in this component's memory: never in browser storage, the URL, a log line or telemetry
 * (the error-ref link reports operation name and error kind only, never variables). They are
 * cleared from memory once the server accepts them.
 */
@Component({
  selector: 'app-equalities-form',
  standalone: true,
  templateUrl: './equalities-form.component.html',
  styleUrl: './equalities-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EqualitiesFormComponent implements OnDestroy {
  /** createDeviceRequest's correlationId: the link between these answers and the request. */
  readonly correlationId = input.required<string>();
  /** The ward the postcode step found, if any. Written to the Sheet only. */
  readonly ward = input<string>('');

  readonly intro = EQUALITIES_INTRO;
  readonly letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** -1 = welcome screen, otherwise an index into `visibleQuestions`. */
  readonly position = signal(-1);
  readonly state = signal<FormState>('answering');
  readonly error = signal<FormError | null>(null);
  readonly answers = signal<Record<string, string>>({});

  readonly visibleQuestions = computed(() => {
    const a = this.answers();
    return EQUALITIES_QUESTIONS.filter((q) => !q.skipWhen || a[q.skipWhen.key] !== q.skipWhen.equals);
  });
  readonly current = computed<EqualitiesQuestion | undefined>(() => this.visibleQuestions()[this.position()]);
  readonly isLast = computed(() => this.position() === this.visibleQuestions().length - 1);
  readonly progress = computed(() => {
    const qs = this.visibleQuestions();
    const a = this.answers();
    return Math.round((qs.filter((q) => a[q.key]).length / qs.length) * 100);
  });

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private advanceTimer?: ReturnType<typeof setTimeout>;
  private focusTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(private readonly apollo: Apollo) {}

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.advanceTimer);
    clearTimeout(this.focusTimer);
  }

  start(): void {
    this.goTo(0);
  }

  choose(choice: string): void {
    const q = this.current();
    if (!q || this.state() !== 'answering') return;
    this.answers.update((a) => ({ ...a, [q.key]: choice }));
    clearTimeout(this.advanceTimer);
    if (!this.isLast()) {
      // Typeform-style auto-advance, with a beat so the selection is visibly confirmed.
      this.advanceTimer = setTimeout(() => this.next(), 350);
    }
  }

  next(): void {
    const q = this.current();
    if (!q || !this.answers()[q.key]) return;
    if (this.isLast()) {
      void this.submit();
    } else {
      this.goTo(this.position() + 1);
    }
  }

  back(): void {
    clearTimeout(this.advanceTimer);
    this.goTo(Math.max(-1, this.position() - 1));
  }

  restart(): void {
    this.answers.set({});
    this.error.set(null);
    this.state.set('answering');
    this.goTo(-1);
  }

  /** From the error box: go back to the last question with every answer kept. */
  dismissError(): void {
    this.error.set(null);
    this.state.set('answering');
    this.focusHeadingSoon();
  }

  async submit(): Promise<void> {
    const a = this.answers();
    const questions = this.visibleQuestions();
    if (this.state() === 'submitting' || questions.some((q) => !a[q.key])) return;

    this.error.set(null);
    this.state.set('submitting');
    const data = {
      correlationId: String(this.correlationId()),
      ward: this.ward() || null,
      answers: questions.map((q) => ({ key: q.key, choice: a[q.key] })),
    };

    try {
      await this.send(data);
    } catch (first) {
      if (!this.isTransportFailure(first)) {
        this.fail(first);
        return;
      }
      // The API may be waking up: wait once, then try again with the same answers.
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
      if (this.destroyed) return;
      try {
        await this.send(data);
      } catch (second) {
        this.fail(second);
        return;
      }
    }

    // Accepted: nothing here needs the answers any more.
    this.answers.set({});
    this.state.set('done');
    this.focusHeadingSoon();
  }

  private send(data: unknown): Promise<unknown> {
    return firstValueFrom(this.apollo.mutate({ mutation: SUBMIT_EQUALITIES, variables: { data } }));
  }

  private isTransportFailure(err: unknown): boolean {
    return graphQLErrorMessages(err).length === 0 && describeError(err).kind === 'network';
  }

  private fail(err: unknown): void {
    const codes = graphQLErrorCodes(err);
    const ref = refForError(err);
    const serverText = graphQLErrorMessages(err)[0];
    if (codes.includes(REQUEST_NOT_FOUND)) {
      this.error.set({ text: serverText, ref, action: 'none' });
    } else if (codes.includes(INVALID_ANSWERS)) {
      this.error.set({ text: serverText, ref, action: 'restart' });
    } else if (codes.includes(SHEET_UNAVAILABLE)) {
      this.error.set({ text: serverText, ref, action: 'retry' });
    } else {
      // Network, rate limit or anything unexpected: the shared friendly wording, answers kept.
      const described = describeError(err);
      this.error.set({ text: described.text, ref: described.ref ?? ref, action: 'retry' });
    }
    this.state.set('error');
    this.focusHeadingSoon();
  }

  private goTo(position: number): void {
    this.position.set(position);
    this.focusHeadingSoon();
  }

  /** Moves focus to the new screen's heading so keyboard and screen-reader users follow along. */
  private focusHeadingSoon(): void {
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => this.heading()?.nativeElement.focus(), 0);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.state() !== 'answering' || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    // Typing in a field is never a shortcut.
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'Enter') {
      // A focused button or link already acts on Enter; acting here too would answer twice.
      if (target?.closest?.('button, a')) return;
      e.preventDefault();
      if (this.position() === -1) this.start();
      else this.next();
      return;
    }
    const q = this.current();
    if (!q || e.key.length !== 1) return;
    const idx = this.letters.indexOf(e.key.toUpperCase());
    if (idx >= 0 && idx < q.choices.length) this.choose(q.choices[idx]);
  }
}
